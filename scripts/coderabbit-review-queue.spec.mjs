// Drives scripts/coderabbit-review-queue.sh --once against a fake `gh` that
// serves fixture JSON, so every case is offline and uses a fixed "now".
// The CodeRabbit wording in the fixtures is copied from real comments on
// this repo (2026-10).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = join(dirname(fileURLToPath(import.meta.url)), 'coderabbit-review-queue.sh');
const REPO = 'acme/school';
const NOW = Date.parse('2026-10-31T12:00:00Z') / 1000;
const iso = (minutesAgo) => new Date((NOW - minutesAgo * 60) * 1000).toISOString().replace('.000', '');

// Fake gh: `gh api <path> --paginate --jq '.[]'` prints the fixture's items,
// `gh api -X POST <path> -f body=...` appends "<path> <body>" to posted.log.
const FAKE_GH = `#!/usr/bin/env bash
shift # api
method=GET; path=""; body=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X) method="$2"; shift 2 ;;
    -f) body="\${2#body=}"; shift 2 ;;
    --paginate) shift ;;
    --jq) shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
if [ "$method" = POST ]; then echo "$path $body" >>"$FIXTURES/posted.log"; echo '{}'; exit 0; fi
file="$FIXTURES/$(printf '%s' "\${path%%\\?*}" | tr '/' '_').json"
[ -f "$file" ] || { echo "no fixture for $path" >&2; exit 1; }
jq -c '.[]' "$file"
`;

let dir;
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

const pr = (number, minutesAgo, extra = {}) => ({
  number,
  title: `PR ${number}`,
  draft: false,
  labels: [],
  created_at: iso(minutesAgo),
  head: { sha: `sha${number}` },
  ...extra,
});
const cr = { login: 'coderabbitai[bot]', type: 'Bot' };
const me = { login: 'tareq89', type: 'User' };
const review = (minutesAgo, sha) => ({ user: cr, submitted_at: iso(minutesAgo), commit_id: sha });
const comment = (user, minutesAgo, body, updatedMinutesAgo = minutesAgo) => ({
  user,
  body,
  created_at: iso(minutesAgo),
  updated_at: iso(updatedMinutesAgo),
});
const RATE_LIMITED = (minutes) =>
  '<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->\n\n' +
  '> [!WARNING]\n> ## Review limit reached\n>\n' +
  `> **Next included review available in ${minutes} minutes.**\n`;
const ACK =
  '<!-- This is an auto-generated reply by CodeRabbit -->\n<details>\n' +
  '<summary>Action performed</summary>\n\nFull review triggered.\n\n</details>';
const TOO_MANY_FILES =
  '<!-- This is an auto-generated comment: rate limited by coderabbit.ai -->\n\n' +
  '> [!IMPORTANT]\n> ## Review skipped\n>\n> Too many files!\n>\n> This PR contains 127 files.';

// prs: [{pr, reviews?, comments?}]
function run(prs, env = {}) {
  dir = mkdtempSync(join(tmpdir(), 'crq-spec-'));
  const bin = join(dir, 'bin');
  execFileSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const put = (path, data) => writeFileSync(join(dir, `${path.replaceAll('/', '_')}.json`), JSON.stringify(data));
  put(`repos/${REPO}/pulls`, prs.map((p) => p.pr));
  for (const p of prs) {
    put(`repos/${REPO}/pulls/${p.pr.number}/reviews`, p.reviews ?? []);
    put(`repos/${REPO}/issues/${p.pr.number}/comments`, p.comments ?? []);
  }
  const out = execFileSync('bash', [script, '--once'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FIXTURES: dir,
      REPO,
      CRQ_NOW: String(NOW),
      TZ: 'UTC',
      ...env,
    },
  });
  const log = join(dir, 'posted.log');
  return { out, posted: existsSync(log) ? readFileSync(log, 'utf8').trim() : '' };
}

describe('coderabbit-review-queue.sh --once', () => {
  it('asks for a full review on the oldest unreviewed PR', () => {
    const { posted } = run([{ pr: pr(3, 10) }, { pr: pr(2, 30) }, { pr: pr(1, 50), reviews: [review(500, 'sha1')] }]);
    expect(posted).toBe(`repos/${REPO}/issues/2/comments @coderabbitai full review`);
  });

  it('waits out the gap after the last review on any PR', () => {
    const { out, posted } = run([{ pr: pr(1, 90), reviews: [review(20, 'sha1')] }, { pr: pr(2, 30) }]);
    expect(posted).toBe('');
    expect(out).toMatch(/wait until 12:40: 60 min gap after the last review {2}\(next up: #2\)/);
  });

  it('honours REVIEW_GAP_MIN', () => {
    const { posted } = run([{ pr: pr(1, 90), reviews: [review(20, 'sha1')] }, { pr: pr(2, 30) }], {
      REVIEW_GAP_MIN: '15',
    });
    expect(posted).toContain('issues/2/comments');
  });

  it('waits for the time CodeRabbit gives in a review-limit comment', () => {
    const { out, posted } = run([
      { pr: pr(1, 90), comments: [comment(me, 30, '@coderabbitai full review'), comment(cr, 60, RATE_LIMITED(19), 5)] },
    ]);
    expect(posted).toBe('');
    // updated 11:55 + 19 min + 60 s buffer = 12:15
    expect(out).toMatch(/wait until 12:15: CodeRabbit review limit/);
  });

  it('asks again once the review limit has passed', () => {
    const { posted } = run([
      { pr: pr(1, 90), comments: [comment(me, 40, '@coderabbitai full review'), comment(cr, 60, RATE_LIMITED(8), 39)] },
    ]);
    expect(posted).toContain('issues/1/comments @coderabbitai full review');
  });

  it('parses the older "Please wait N minutes and S seconds" wording', () => {
    const body = '> ## Rate limit exceeded\n> Please wait **7 minutes and 30 seconds** before requesting another review.';
    const { out } = run([{ pr: pr(1, 90), comments: [comment(cr, 60, body, 2)] }]);
    // updated 11:58 + 7m30s + 60 s = 12:06:30
    expect(out).toMatch(/wait until 12:06: CodeRabbit review limit/);
  });

  it('treats an un-acked ask as in flight for ACK_WAIT_MIN, then retries', () => {
    const fresh = run([{ pr: pr(1, 90), comments: [comment(me, 5, '@coderabbitai full review')] }]);
    expect(fresh.posted).toBe('');
    expect(fresh.out).toMatch(/#1: asked, waiting for ack/);

    const stale = run([{ pr: pr(1, 90), comments: [comment(me, 20, '@coderabbitai full review')] }]);
    expect(stale.posted).toContain('issues/1/comments');
  });

  it('gives an acked review REVIEW_WAIT_MIN before retrying', () => {
    const { out, posted } = run([
      { pr: pr(1, 90), comments: [comment(me, 40, '@coderabbitai full review'), comment(cr, 39, ACK)] },
    ]);
    expect(posted).toBe('');
    expect(out).toMatch(/#1: CodeRabbit acked, review running/);
  });

  it('skips a PR CodeRabbit refuses for too many files, and moves on', () => {
    const { out, posted } = run([{ pr: pr(1, 90), comments: [comment(cr, 80, TOO_MANY_FILES)] }, { pr: pr(2, 30) }]);
    expect(out).toContain('#1 (CodeRabbit: too many files)');
    expect(posted).toContain('issues/2/comments');
  });

  it('stops asking after MAX_ATTEMPTS', () => {
    const asks = [200, 150, 100, 50].map((m) => comment(me, m, '@coderabbitai full review'));
    const { out, posted } = run([{ pr: pr(1, 300), comments: asks }]);
    expect(out).toContain('#1 (asked 4x with no review)');
    expect(posted).toBe('');
  });

  it('skips drafts and the skip label', () => {
    const { out, posted } = run([
      { pr: pr(1, 90, { draft: true }) },
      { pr: pr(2, 60, { labels: [{ name: 'no-coderabbit' }] }) },
    ]);
    expect(posted).toBe('');
    expect(out).toMatch(/nothing needs a review/);
  });

  it('REVIEW_SCOPE=head asks for an incremental review of a new head commit', () => {
    const { posted } = run([{ pr: pr(1, 300), reviews: [review(200, 'old-sha')] }], { REVIEW_SCOPE: 'head' });
    expect(posted).toBe(`repos/${REPO}/issues/1/comments @coderabbitai review`);
  });

  it('--dry-run never comments', () => {
    const { out, posted } = run([{ pr: pr(1, 30) }], { DRY_RUN: '1' });
    expect(posted).toBe('');
    expect(out).toContain("DRY RUN: would comment '@coderabbitai full review' on #1");
  });
});
