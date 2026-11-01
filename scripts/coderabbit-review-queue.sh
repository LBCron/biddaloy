#!/usr/bin/env bash
#
# coderabbit-review-queue.sh — get every open PR a CodeRabbit review, one at
# a time, without tripping CodeRabbit's review limit.
#
# Why this exists
# ---------------
# Two things leave PRs here without a CodeRabbit review:
#   1. Auto review only runs on PRs into main / develop / feature-* / epic-*
#      (.coderabbit.yaml). A stacked PR into `epic/97/accum-3` or
#      `claude/...-pr2` gets "Review skipped" and needs a manual
#      `@coderabbitai full review`.
#   2. CodeRabbit's review limit. When it is hit, CodeRabbit edits its summary
#      comment to "Review limit reached ... Next included review available in
#      19 minutes." and the review never happens unless someone asks again.
#
# This script is the "someone asks again", paced so it does not burn the limit.
#
# How one tick decides (all state is read back from GitHub, nothing local)
# -----------------------------------------------------------------------
#
#   list open PRs (oldest first, skip drafts and the SKIP_LABEL)
#        |
#   for each PR read CodeRabbit's reviews + comments and classify it:
#        reviewed  - has a CodeRabbit review (REVIEW_SCOPE=head: on the head commit)
#        in-flight - we asked; CodeRabbit acked ("Review triggered") and less
#                    than REVIEW_WAIT_MIN passed, or did not ack yet and less
#                    than ACK_WAIT_MIN passed
#        skipped   - "Too many files", or MAX_ATTEMPTS asks with no review
#        needs     - everything else
#        |
#   any PR in-flight?                         -> wait POLL_MIN, look again
#   CodeRabbit said "available in N minutes"? -> wait until then (+ BUFFER_SEC)
#   last CodeRabbit review < REVIEW_GAP_MIN ago (on ANY PR, auto reviews
#   included, because they spend the same limit)?  -> wait until the gap ends
#   oldest "needs" PR                         -> comment the review command
#
# A rate-limited ask is not wasted: the next tick reads the new
# "available in N minutes" and waits exactly that long.
#
# Because the state lives on GitHub, the script can be stopped and restarted at
# any time without losing its place.
#
# Where it runs: your Mac, in a terminal tab you leave open. It is not a CI
# job: CodeRabbit ignores commands from bot accounts, so the comments must come
# from your own `gh` login. While it loops it holds `caffeinate -i`, so the Mac
# does not idle-sleep and stop the queue (closing the lid still sleeps it).
#
# Usage
# -----
#   scripts/coderabbit-review-queue.sh            # loop until Ctrl-C
#   scripts/coderabbit-review-queue.sh --dry-run  # loop, print, never comment
#   scripts/coderabbit-review-queue.sh --once     # one check, then exit
#
# Needs (macOS): bash 3.2 (the built-in one is fine), and
#   brew install gh jq && gh auth login
#
# Settings (environment variables)
# --------------------------------
#   REPO             owner/repo                     default tareq89/biddaloy
#   REVIEW_SCOPE     any  = PR has any CodeRabbit review       default any
#                    head = review must be on the head commit
#   REVIEW_GAP_MIN   minutes after the last review before asking again  60
#   ACK_WAIT_MIN     minutes to wait for "Review triggered"             15
#   REVIEW_WAIT_MIN  minutes to wait for the review after the ack       60
#   POLL_MIN         minutes between checks while something is pending   3
#   IDLE_MIN         minutes between checks when nothing needs a review 15
#   MAX_ATTEMPTS     asks per PR (since its last review) before skipping 4
#   BUFFER_SEC       seconds added to CodeRabbit's "available in"       60
#   INCLUDE_DRAFTS   1 = also review draft PRs                           0
#   SKIP_LABEL       PRs with this label are left alone   no-coderabbit
#   DRY_RUN          1 = same as --dry-run                               0
#   CRQ_NOW          fake "now" (epoch seconds), for tests only

set -uo pipefail

REPO="${REPO:-tareq89/biddaloy}"
REVIEW_SCOPE="${REVIEW_SCOPE:-any}"
REVIEW_GAP_MIN="${REVIEW_GAP_MIN:-60}"
ACK_WAIT_MIN="${ACK_WAIT_MIN:-15}"
REVIEW_WAIT_MIN="${REVIEW_WAIT_MIN:-60}"
POLL_MIN="${POLL_MIN:-3}"
IDLE_MIN="${IDLE_MIN:-15}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-4}"
BUFFER_SEC="${BUFFER_SEC:-60}"
INCLUDE_DRAFTS="${INCLUDE_DRAFTS:-0}"
SKIP_LABEL="${SKIP_LABEL:-no-coderabbit}"
DRY_RUN="${DRY_RUN:-0}"
ONCE=0

for arg in "$@"; do
  case "$arg" in
    --once) ONCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help)
      sed -n '2,/^set -uo/p' "$0" | sed 's/^# \{0,1\}//' | sed '$d'
      exit 0
      ;;
    *)
      echo "unknown argument: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

case "$REVIEW_SCOPE" in any | head) ;; *)
  echo "REVIEW_SCOPE must be 'any' or 'head'" >&2
  exit 2
  ;;
esac

for tool in gh jq; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "missing '$tool' (macOS: brew install $tool)" >&2
    exit 2
  fi
done

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/crq.XXXXXX")"
LOCK_DIR="${TMPDIR:-/tmp}/coderabbit-review-queue.${REPO//\//_}.lock"
cleanup() {
  rm -rf "$WORK_DIR"
  if [ "$ONCE" = 0 ] && [ -f "$LOCK_DIR/pid" ] && [ "$(cat "$LOCK_DIR/pid")" = "$$" ]; then
    rm -rf "$LOCK_DIR"
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

now() { if [ -n "${CRQ_NOW:-}" ]; then echo "$CRQ_NOW"; else date -u +%s; fi; }
log() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
fmt_time() { jq -rn --argjson t "$1" '$t | strflocaltime("%H:%M")'; }

# One JSON value per line from a paginated REST list.
gh_list() { gh api "$1" --paginate --jq '.[]'; }

# Classifies one PR. Input: {pr, reviews, comments}. Output: one status object.
# CodeRabbit wording this matches (seen on this repo, 2026-10):
#   summary comment, rate limited: "## Review limit reached" ...
#       "**Next included review available in 19 minutes.**"
#   older wording:   "Rate limit exceeded" ... "Please wait **7 minutes and 3 seconds**"
#   too many files:  "## Review skipped" ... "Too many files!"
#   command ack:     "<!-- This is an auto-generated reply by CodeRabbit -->" ...
#                    "Review triggered." / "Full review triggered."
# shellcheck disable=SC2016 # $vars below are jq variables, not shell ones.
CLASSIFY='
def ts: fromdateiso8601;
def is_cr: (.user.login // "") | startswith("coderabbitai");
def wait_secs:
  [ scan("(?i)(?:available in|please wait)[^0-9\\n]{0,12}((?:[0-9]+ *(?:hours?|minutes?|seconds?)[ ,and]*)+)") | .[0] ][0]
  | if . == null then null
    else [ scan("(?i)([0-9]+) *(hour|minute|second)") | (.[0] | tonumber) * ({"hour":3600,"minute":60,"second":1}[.[1] | ascii_downcase]) ] | add
    end;

. as $in
| ($in.reviews | map(select(is_cr and .submitted_at != null))) as $rv
| ($rv | map(.submitted_at | ts) | max) as $last_review
| ($rv | any(.commit_id == $in.pr.head.sha)) as $head_reviewed
| ($in.comments | map(select(is_cr))) as $crc
| ($in.comments
    | map(select((.user.type // "") != "Bot"
                 and (.body | test("^\\s*@coderabbitai\\s+(full\\s+)?review\\s*$"; "i")))
          | .created_at | ts)) as $triggers
| ($triggers | max) as $last_trigger
| ($triggers | map(select(. > ($last_review // 0))) | length) as $attempts
| ($crc | map(select(.body | test("auto-generated reply by coderabbit"; "i"))
              | select(.body | test("review triggered"; "i")) | .created_at | ts)) as $acks
| ($crc | map(select(.body | test("Review limit reached|Rate limit exceeded"; "i"))
              | (.updated_at | ts) as $at
              | {at: $at, until: ($at + ((.body | wait_secs) // ($idle * 60)) + $buffer)})) as $limits
| ($limits | map(.until) | max) as $cooldown_until
| ($limits | map(.at) | max) as $limited_at
| ($crc | any(.body | test("Too many files"; "i") and test("Review skipped"; "i"))) as $too_big
| (if $scope == "head" then ($head_reviewed | not) else ($last_review == null) end) as $needs
| ($last_trigger != null and $last_trigger > ($last_review // 0)) as $asked
| ($asked and ($acks | any(. >= $last_trigger))) as $acked
| ($asked and ($limited_at // 0) >= $last_trigger) as $limited_after_ask
| {
    number: $in.pr.number,
    title: $in.pr.title,
    created: ($in.pr.created_at | ts),
    last_review: $last_review,
    last_trigger: $last_trigger,
    cooldown_until: $cooldown_until,
    attempts: $attempts,
    command: (if $last_review == null then "@coderabbitai full review" else "@coderabbitai review" end),
    state: (
      if ($needs | not) then "reviewed"
      elif $too_big then "skipped"
      elif ($asked and ($limited_after_ask | not)
            and ($now - $last_trigger) < (if $acked then $review_wait else $ack_wait end) * 60)
        then "in-flight"
      elif $attempts >= $max_attempts then "skipped"
      else "needs" end),
    reason: (
      if ($needs | not) then "has a CodeRabbit review"
      elif $too_big then "CodeRabbit: too many files"
      elif $attempts >= $max_attempts then "asked \($attempts)x with no review"
      elif $acked then "CodeRabbit acked, review running"
      elif $asked then "asked, waiting for ack"
      else "no review yet" end)
  }
'

# Decides what the queue does now. Input: array of status objects.
# shellcheck disable=SC2016
DECIDE='
(map(.last_review // empty) | max) as $last_review
| (map(.cooldown_until // empty) | max) as $cooldown
| (map(select(.state == "needs")) | sort_by(.created)) as $todo
| (map(select(.state == "in-flight")) | first) as $flying
| (($last_review // 0) + $gap * 60) as $gap_end
| {
    counts: (group_by(.state) | map({key: .[0].state, value: length}) | from_entries),
    skipped: map(select(.state == "skipped") | "#\(.number) (\(.reason))"),
    next: ($todo | first),
    flying: $flying
  }
  + if $flying != null then {action: "wait", until: ($now + $poll * 60), why: "#\($flying.number): \($flying.reason)"}
    elif ($todo | length) == 0 then {action: "idle", until: ($now + $idle * 60), why: "nothing needs a review"}
    elif ($cooldown // 0) > $now then {action: "wait", until: $cooldown, why: "CodeRabbit review limit"}
    elif $gap_end > $now then {action: "wait", until: $gap_end, why: "\($gap) min gap after the last review"}
    else {action: "ask", until: ($now + $poll * 60), why: "#\($todo[0].number): \($todo[0].reason)"} end
'

# One pass over the queue. Prints a log line, may post one comment, and sets
# SLEEP_FOR (seconds) for the loop.
SLEEP_FOR=60
tick() {
  local t n decision action wake_at why next_n next_cmd counts skipped
  t="$(now)"
  SLEEP_FOR=$((POLL_MIN * 60))

  if ! gh_list "repos/$REPO/pulls?state=open&per_page=100" >"$WORK_DIR/prs.jsonl"; then
    log "could not list PRs (gh error above); retrying in $POLL_MIN min"
    return 0
  fi

  jq -s -c --arg skip "$SKIP_LABEL" --argjson drafts "$INCLUDE_DRAFTS" '
    map(select(($drafts == 1 or (.draft | not))
               and (.labels | map(.name) | index($skip) | not)))
    | sort_by(.created_at) | .[]' "$WORK_DIR/prs.jsonl" >"$WORK_DIR/prs.ndjson"

  : >"$WORK_DIR/status.jsonl"
  while IFS= read -r pr_line; do
    printf '%s\n' "$pr_line" >"$WORK_DIR/pr.json"
    n="$(jq -r .number "$WORK_DIR/pr.json")"
    if ! gh_list "repos/$REPO/pulls/$n/reviews?per_page=100" >"$WORK_DIR/reviews.jsonl" ||
      ! gh_list "repos/$REPO/issues/$n/comments?per_page=100" >"$WORK_DIR/comments.jsonl"; then
      log "could not read PR #$n (gh error above); retrying in $POLL_MIN min"
      return 0
    fi
    jq -n \
      --slurpfile pr "$WORK_DIR/pr.json" \
      --slurpfile reviews "$WORK_DIR/reviews.jsonl" \
      --slurpfile comments "$WORK_DIR/comments.jsonl" \
      '{pr: $pr[0], reviews: $reviews, comments: $comments}' |
      jq -c \
        --argjson now "$t" --arg scope "$REVIEW_SCOPE" \
        --argjson ack_wait "$ACK_WAIT_MIN" --argjson review_wait "$REVIEW_WAIT_MIN" \
        --argjson max_attempts "$MAX_ATTEMPTS" --argjson idle "$IDLE_MIN" \
        --argjson buffer "$BUFFER_SEC" \
        "$CLASSIFY" >>"$WORK_DIR/status.jsonl"
  done <"$WORK_DIR/prs.ndjson"

  decision="$(jq -s -c \
    --argjson now "$t" --argjson gap "$REVIEW_GAP_MIN" \
    --argjson poll "$POLL_MIN" --argjson idle "$IDLE_MIN" \
    "$DECIDE" "$WORK_DIR/status.jsonl")"

  action="$(jq -r .action <<<"$decision")"
  wake_at="$(jq -r .until <<<"$decision")"
  why="$(jq -r .why <<<"$decision")"
  counts="$(jq -r '.counts | to_entries | map("\(.value) \(.key)") | join(", ")' <<<"$decision")"
  skipped="$(jq -r '.skipped | join(", ")' <<<"$decision")"
  log "open PRs: ${counts:-none}${skipped:+  [skipped: $skipped]}"

  case "$action" in
    ask)
      next_n="$(jq -r .next.number <<<"$decision")"
      next_cmd="$(jq -r .next.command <<<"$decision")"
      if [ "$DRY_RUN" = 1 ]; then
        log "DRY RUN: would comment '$next_cmd' on #$next_n ($why)"
      elif gh api -X POST "repos/$REPO/issues/$next_n/comments" -f body="$next_cmd" >/dev/null; then
        log "asked CodeRabbit on #$next_n: '$next_cmd' ($why)"
      else
        log "could not comment on #$next_n (gh error above)"
      fi
      ;;
    *)
      next_n="$(jq -r '.next.number // empty' <<<"$decision")"
      log "$action until $(fmt_time "$wake_at"): $why${next_n:+  (next up: #$next_n)}"
      ;;
  esac

  SLEEP_FOR=$((wake_at - t))
  # Re-read GitHub at least every IDLE_MIN so a new PR, a push or a manual
  # review changes the plan without waiting out a long gap.
  [ "$SLEEP_FOR" -gt $((IDLE_MIN * 60)) ] && SLEEP_FOR=$((IDLE_MIN * 60))
  [ "$SLEEP_FOR" -lt 30 ] && SLEEP_FOR=30
  return 0
}

if [ "$ONCE" = 1 ]; then
  tick
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  other="$(cat "$LOCK_DIR/pid" 2>/dev/null || true)"
  if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
    echo "already running for $REPO (pid $other)" >&2
    exit 1
  fi
  rm -rf "$LOCK_DIR" && mkdir "$LOCK_DIR"
fi
echo "$$" >"$LOCK_DIR/pid"

# Keep the Mac from idle-sleeping for as long as this process lives.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -i -w "$$" &
fi

log "watching $REPO (scope=$REVIEW_SCOPE, gap=${REVIEW_GAP_MIN}m, dry-run=$DRY_RUN); Ctrl-C to stop"
while true; do
  tick
  sleep "$SLEEP_FOR"
done
