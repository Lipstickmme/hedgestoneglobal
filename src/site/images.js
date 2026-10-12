'use strict';

/**
 * Resolves the page-level image slots at build time.
 *
 * Every slot names the file it would rather have and the placeholder it uses
 * until that file exists. So adding real photography is a file drop, not a
 * code change: put the artwork into public/assets/img/ in any common format
 * and the next build picks it up in place of the generated placeholders.
 *
 * Slots are one-to-one with placements on purpose. Sharing one slot between
 * two pages is how a visitor ends up meeting the same photograph twice, so
 * each page header and each panel owns its own.
 */

const fs = require('fs');
const path = require('path');

const data = require('../data/images.json');

const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');
// Preference order, best format first. WebP wins, so a converted copy is used
// in place of a heavy original without anyone having to delete the original.
const EXTENSIONS = ['.webp', '.avif', '.jpg', '.jpeg', '.png', '.svg'];
// Supplied photography first. Both directories are searched, but /assets/img/
// is where real artwork is dropped and /assets/bank/ is where the generated
// placeholders ship - so when a name exists in both, the real one has to win.
// Getting this the wrong way round is invisible in the markup and obvious only
// on the page, where the placeholder is still showing.
const DIRS = ['/assets/img/', '/assets/bank/'];

const found = [];

/**
 * Every candidate file, indexed by lower-cased name.
 *
 * Case-insensitive on purpose: an upload named Rockfield3.png has to be found
 * on Linux, where the deploy runs, not only on the machine it was named on.
 */
const index = new Map();
DIRS.forEach((dir) => {
  const abs = path.join(PUBLIC_DIR, dir);
  let entries = [];
  try {
    entries = fs.readdirSync(abs);
  } catch (err) {
    return;
  }
  entries.forEach((file) => {
    const key = `${dir}${file.toLowerCase()}`;
    if (!index.has(key)) index.set(key, `${dir}${file}`);
  });
});

/** The first file that actually exists for any of these base names. */
function lookUp(names) {
  for (const name of names || []) {
    for (const dir of DIRS) {
      for (const ext of EXTENSIONS) {
        const hit = index.get(`${dir}${name}${ext}`.toLowerCase());
        if (hit) return hit;
      }
    }
  }
  return null;
}

function resolve(spec) {
  if (typeof spec === 'string') return spec;
  const hit = lookUp(spec.prefer);
  if (hit) found.push(hit);
  return hit || spec.fallback;
}

/** Keys beginning with an underscore are notes for whoever edits the file. */
const isSlot = ([key, spec]) => !key.startsWith('_') && spec && typeof spec === 'object';

const images = {};
Object.entries(data.slots).filter(isSlot).forEach(([slot, spec]) => {
  images[slot] = resolve(spec);
});

/** Customer-story artwork, keyed by the `image` name in projects.json. */
images.stories = {};
Object.entries(data.stories).filter(isSlot).forEach(([key, spec]) => {
  images.stories[key] = resolve(spec);
});

/**
 * The photograph for a customer story, by key.
 *
 * An unknown key falls back to the generic placeholder rather than throwing:
 * a story added to projects.json without artwork should still build.
 */
images.story = (key) => images.stories[key] || '/assets/bank/placeholder.svg';

/** What the build should report: which supplied images were picked up, if any. */
images._resolved = found;

/**
 * Any photograph used by more than one slot.
 *
 * Reported by the build. The slots are one-to-one by design, so a repeat here
 * means two of them resolved onto the same file - usually a name in `prefer`
 * that matches artwork another slot already claimed.
 */
images._repeated = Array.from(
  found.reduce((counts, file) => counts.set(file, (counts.get(file) || 0) + 1), new Map())
).filter(([, count]) => count > 1).map(([file]) => file);

module.exports = images;
