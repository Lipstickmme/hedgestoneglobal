'use strict';

/**
 * Build every static HTML page from the shared layouts and per-page content.
 * Run with `npm run build`. Output goes to public/*.html.
 *
 * Two sets: the public bank site (src/site/pages.js, wrapped by the marketing
 * layout) and the signed-in application, its sign-in pages and the staff
 * console (src/bank/site/*, each of which brings its own shell).
 */

const fs = require('fs');
const path = require('path');
const pages = require('../src/site/pages');
const appPages = require('../src/bank/site/pages-app');
const consolePages = require('../src/bank/site/pages-console');
const images = require('../src/site/images');

const publicDir = path.join(__dirname, '..', 'public');

let count = 0;
const write = (file, html) => {
  fs.writeFileSync(path.join(publicDir, file), html, 'utf8');
  count += 1;
  console.log(`  built ${file} (${(html.length / 1024).toFixed(1)}kB)`);
};

for (const def of [...pages, ...appPages, ...consolePages]) write(def.file, def.build(def.opts));

console.log(`[build] wrote ${count} pages`);

// Say out loud which supplied artwork was picked up, so a deploy still running
// on the generated placeholders is obvious from the build log rather than the
// page.
const picked = Array.from(new Set(images._resolved));
if (picked.length) {
  console.log(`[build] using ${picked.length} supplied image(s): ${picked.join(', ')}`);
} else {
  console.log('[build] no supplied artwork found in public/assets/img: using the generated placeholder artwork');
}

// The slots are one-to-one with placements so that no photograph appears on
// two pages. If two of them land on the same file the pages still build and
// still look fine one at a time, which is exactly why it needs saying here.
if (images._repeated.length) {
  console.warn(`[build] WARNING: ${images._repeated.length} image(s) used by more than one slot: ${images._repeated.join(', ')}`);
}
