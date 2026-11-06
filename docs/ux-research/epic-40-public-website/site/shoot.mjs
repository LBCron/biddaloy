// usage:
//   node shoot.mjs                              shoot every page and variant (the full set listed below)
//   node shoot.mjs <file.html[?query]> <out>    shoot one page → <out>-1440.webp and <out>-390.webp (full page)
// Paths are relative to this folder. Every shot prints horizontal-overflow=<n>px, which must be 0 at 390.
// Shots are WebP quality 80 (git keeps every committed image forever, PNG was 26 MB). Needs `cwebp`
// on PATH (macOS: brew install webp; Debian/Ubuntu: apt install webp). A page JS error fails the run.
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const themes = [
  'primary',
  'high-school',
  'college',
  'madrasa',
  'international',
  'premium',
  'basic',
];
const basicPages = ['admissions', 'notices', 'results', 'teachers', 'contact', 'blog-post'];

function allJobs() {
  const j = [];
  for (const t of themes) {
    j.push([`${t}/home.html`, `shots/${t}-home`]);
    j.push([`${t}/home.html?skip=news&notag=1`, `shots/${t}-home-skipped`]);
    j.push([`${t}/palettes.html`, `shots/${t}-palettes`]);
  }
  for (const p of basicPages) j.push([`basic/${p}.html`, `shots/basic-${p}`]);
  j.push(['basic/home.html?photos=1', 'shots/basic-home-onephoto']);
  for (const t of ['basic', 'college'])
    j.push([`${t}/home-reordered.html`, `shots/${t}-home-reordered`]);
  return j;
}

const jobs = process.argv[2] ? [[process.argv[2], process.argv[3]]] : allJobs();
if (spawnSync('cwebp', ['-version']).status !== 0) {
  console.error('cwebp not found: brew install webp');
  process.exit(2);
}
const browser = await chromium.launch();
let bad = 0;
for (const [file, out] of jobs) {
  const [path, query = ''] = file.split('?');
  const url = 'file://' + resolve(here, path) + (query ? '?' + query : '');
  // the skipped and one-photo variants are specified at 390 only
  for (const [w, h] of /-(skipped|onephoto)$/.test(out)
    ? [[390, 844]]
    : [
        [1440, 900],
        [390, 844],
      ]) {
    const page = await browser.newPage({
      viewport: { width: w, height: path.endsWith('palettes.html') ? 6000 : h },
      deviceScaleFactor: 1,
    });
    page.on('pageerror', (e) => {
      bad++;
      console.log(`${out}-${w}  PAGE ERROR ${e.message}`);
    });
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(path.endsWith('palettes.html') ? 2800 : 800);
    if (path.endsWith('palettes.html')) {
      // out-of-view iframes only paint once scrolled to
      for (let y = 0; y < 12000; y += 600) {
        await page.evaluate((v) => scrollTo(0, v), y);
        await page.waitForTimeout(250);
      }
      await page.evaluate(() => scrollTo(0, 0));
      await page.waitForTimeout(600);
    }
    const full = await page.evaluate(() => document.documentElement.scrollHeight);
    const png = resolve(here, `${out}-${w}.tmp.png`),
      webp = resolve(here, `${out}-${w}.webp`);
    await page.screenshot({
      path: png,
      ...(path.endsWith('palettes.html')
        ? { clip: { x: 0, y: 0, width: w, height: full } }
        : { fullPage: true }),
    });
    if (spawnSync('cwebp', ['-quiet', '-q', '80', png, '-o', webp]).status !== 0) bad++;
    unlinkSync(png);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (w === 390 && overflow !== 0) bad++;
    console.log(`${out}-${w}.webp  horizontal-overflow=${overflow}px`);
    await page.close();
  }
}
await browser.close();
process.exit(bad ? 1 : 0);
