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

const crypto = require('crypto');

const publicDir = path.join(__dirname, '..', 'public');

/**
 * Stamp every local stylesheet, script, image and icon a page links with a
 * short hash of the file's contents: /css/bank.css?v=1a2b3c4d.
 *
 * Images and fonts are served with a week-long immutable cache, so when a file
 * is replaced under the same name - the logo, a photograph - a returning
 * visitor's browser would keep showing the old one for days. A new hash is a
 * new URL, so a changed file is fetched at once and an unchanged one stays
 * cached.
 */
const stamps = new Map();
function stamp(url) {
  if (!stamps.has(url)) {
    let v = '';
    try {
      v = crypto.createHash('sha1').update(fs.readFileSync(path.join(publicDir, url))).digest('hex').slice(0, 8);
    } catch (err) {
      v = '';
    }
    stamps.set(url, v);
  }
  const v = stamps.get(url);
  return v ? `${url}?v=${v}` : url;
}
const ASSET_REF = /(\b(?:src|href)=")(\/(?:assets|css|js)\/[^"?#]+|\/(?:favicon\.(?:ico|png)|apple-touch-icon\.png))(")/g;
const versioned = (html) => html.replace(ASSET_REF, (m, pre, url, post) => `${pre}${stamp(url)}${post}`);

let count = 0;
const write = (file, html) => {
  html = versioned(html);
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
