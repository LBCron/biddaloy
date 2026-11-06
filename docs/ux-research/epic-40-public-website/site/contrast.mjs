// usage: node contrast.mjs   → prints WCAG ratios for every palette in shared/palettes.js, exit 1 if one fails.
// Checks: ink on surface >= 4.5 (body text), surface on primary >= 4.5 (button/band text),
// secondary >= 3 on surface or on primary (large text / UI), accent as UI colour: >= 3 on surface OR >= 4.5 against ink text drawn on it.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
// palettes.js is a plain script (prettier writes it as JS, not JSON), so run it against a stub window
const ctx = { window: {} };
runInNewContext(readFileSync(new URL('./shared/palettes.js', import.meta.url), 'utf8'), ctx);
const P = ctx.window.SITE_PALETTES;
const lum = (h) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
let bad = 0;
for (const [theme, { sets }] of Object.entries(P)) {
  sets.forEach((s, i) => {
    const r = {
      body: ratio(s.ink, s.surface),
      onPrimary: ratio(s.surface, s.primary),
      second: Math.max(ratio(s.secondary, s.surface), ratio(s.secondary, s.primary)),
      accentUi: ratio(s.accent, s.surface),
      accentInk: ratio(s.accent, s.ink),
    };
    const ok =
      r.body >= 4.5 &&
      r.onPrimary >= 4.5 &&
      r.second >= 3 &&
      (r.accentUi >= 3 || r.accentInk >= 4.5);
    if (!ok) bad++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${theme} #${i} ${s.en.padEnd(24)} body ${r.body.toFixed(2)}  on-primary ${r.onPrimary.toFixed(2)}  secondary ${r.second.toFixed(2)}  accent ${r.accentUi.toFixed(2)}/${r.accentInk.toFixed(2)}`,
    );
  });
}
process.exit(bad ? 1 : 0);
