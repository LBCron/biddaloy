#!/usr/bin/env node
// Usage: node shoot.mjs <mockup.html> [out-dir]
//
// Renders a mockup with the app's REAL stylesheet (ui/src/styles/globals.css)
// and writes <out-dir>/desktop.png and <out-dir>/mobile.png, then prints a
// JSON report of things a screenshot cannot show you (horizontal overflow,
// small tap targets, unlabeled buttons, heading count).
//
// The mockup must contain the marker `<!-- app:head -->` inside <head>.
// Exit code 1 = a hard failure the design must fix before it is posted.
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MARK = "<!-- app:head -->";
const VIEWS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

const [mockupArg, outArg] = process.argv.slice(2);
if (!mockupArg) {
  console.error("usage: node shoot.mjs <mockup.html> [out-dir]");
  process.exit(2);
}
const mockup = resolve(mockupArg);
const out = resolve(outArg ?? dirname(mockup));
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const styles = resolve(root, "ui/src/styles");

const html = readFileSync(mockup, "utf8");
if (!html.includes(MARK)) {
  console.error(`mockup is missing the ${MARK} marker in <head>`);
  process.exit(2);
}

// ponytail: Tailwind is compiled in the browser from a CDN build, so this
// needs network and cannot resolve node packages or scan source files. If it
// ever drifts from the real build, compile globals.css with the repo's own
// Tailwind instead.
const css = readFileSync(resolve(styles, "globals.css"), "utf8")
  .replace(/^@import "tw-animate-css";$/m, "")
  .replace(/^@import "sonner\/dist\/styles.css";$/m, "")
  .replace(/^@source .*$/m, "")
  .replaceAll('url("./fonts/', `url("${pathToFileURL(styles).href}/fonts/`);
const head = [
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
  `<style type="text/tailwindcss">${css}</style>`,
].join("\n");

mkdirSync(out, { recursive: true });
const render = resolve(out, "_render.html");
writeFileSync(render, html.replace(MARK, () => head));

const browser = await chromium.launch();
const report = {};
for (const [name, viewport] of Object.entries(VIEWS)) {
  const mobile = name === "mobile";
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 2,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto(pathToFileURL(render).href, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });

  report[name] = await page.evaluate((checkTargets) => {
    const label = (el) =>
      (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const controls = [
      ...document.querySelectorAll("button, a[href], input, select, textarea, [role=button]"),
    ].filter((el) => el.getBoundingClientRect().height > 0);
    const doc = document.documentElement;
    return {
      overflowX: doc.scrollWidth - doc.clientWidth,
      h1Count: document.querySelectorAll("h1").length,
      unlabeledControls: controls
        .filter((el) => /^(BUTTON|A)$/.test(el.tagName) && !label(el))
        .map((el) => el.outerHTML.slice(0, 80)),
      smallTargets: checkTargets
        ? controls
            .filter((el) => el.getBoundingClientRect().height < 44)
            .map((el) => `${el.tagName.toLowerCase()} "${label(el)}" ${Math.round(el.getBoundingClientRect().height)}px`)
        : [],
    };
  }, mobile);
  report[name].pageErrors = pageErrors;
  await page.close();
}
await browser.close();

console.log(JSON.stringify({ out, files: Object.keys(VIEWS).map((n) => `${n}.png`), report }, null, 2));

const hard = Object.entries(report).flatMap(([name, r]) => [
  ...(r.overflowX > 0 ? [`${name}: page scrolls sideways by ${r.overflowX}px`] : []),
  ...(r.h1Count !== 1 ? [`${name}: expected exactly one <h1>, found ${r.h1Count}`] : []),
  ...r.unlabeledControls.map((c) => `${name}: control has no text or aria-label: ${c}`),
  ...r.pageErrors.map((e) => `${name}: page error: ${e}`),
]);
if (hard.length) {
  console.error(`\nFIX BEFORE POSTING:\n- ${hard.join("\n- ")}`);
  process.exit(1);
}
