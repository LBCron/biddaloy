// Runs INSIDE the built app image (publish-image.yml mounts it): every package that the
// compiled server requires must resolve from where that file sits. Catches a dependency that
// only a dev install provides (e.g. `express` came from a dev tool, so the production image
// crashed at boot with "Cannot find module 'express'").
//   docker run --rm -v "$PWD/scripts/check-image-requires.cjs:/check.cjs:ro" <image> node /check.cjs
// The site image (site/Dockerfile) runs it at build time on its ESM bundle (.mjs, `from "x"`).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createRequire, builtinModules } = require('node:module');

// The compiled server, and the shared workspace it imports (/app/node_modules/@biddaloy/shared -> /app/shared).
const roots =
  process.argv.length > 2
    ? process.argv.slice(2).map((r) => path.resolve(r))
    : ['/app/server/dist', '/app/shared/dist', '/app/site-themes/dist'];
// Test-only files are compiled too but never loaded in production.
const skip = /\.(spec|e2e-spec|integration\.spec|test-helper)\.js$/;
const builtins = new Set(builtinModules);
const missing = new Map();
let files = 0;

function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.m?js$/.test(e.name) && !skip.test(e.name)) check(p);
  }
}

function check(file) {
  files++;
  const req = createRequire(file);
  const src = fs.readFileSync(file, 'utf8');
  // CommonJS require("x"); in an ES module (.mjs) also `from "x"` / `import "x"`.
  const re = file.endsWith('.mjs')
    ? /(?:require\(|\bfrom\s*|\bimport\s*\(?\s*)["']([^"'./$][^"']*)["']/g
    : /require\("([^"./][^"]*)"\)/g;
  for (const m of src.matchAll(re)) {
    const spec = m[1];
    // astro:* are build-time virtual modules, resolved by Vite, never at runtime.
    if (spec.startsWith('astro:')) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (spec.startsWith('node:') || builtins.has(name)) continue;
    try {
      req.resolve(spec);
    } catch {
      if (!missing.has(spec)) missing.set(spec, file);
    }
  }
}

for (const r of roots) if (fs.existsSync(r)) walk(r);
if (missing.size) {
  console.error(`image is missing ${missing.size} module(s) the server requires:`);
  for (const [spec, file] of missing) console.error(`  ${spec}  (first needed by ${file})`);
  console.error(
    'Add each to the dependencies of the workspace that imports it (server/package.json).',
  );
  process.exit(1);
}
console.log(`image requires ok: ${files} files checked`);
