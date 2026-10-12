'use strict';

/**
 * Simulate what Vercel uploads and prove the build still works.
 *
 * .vercelignore uses .gitignore matching, where an unanchored pattern such as
 * "data/" matches at ANY depth. That once excluded src/data as well as the
 * root data directory, and the deploy failed on a missing JSON file that was
 * present locally. This reproduces the upload so that can't happen unnoticed.
 *
 * Run: node scripts/check-vercel-upload.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const root = path.join(__dirname, '..');
const ignoreFile = path.join(root, '.vercelignore');

function tracked() {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
}

/** Files .vercelignore would exclude, using git's own matcher. */
function excluded(files) {
  if (!fs.existsSync(ignoreFile)) return new Set();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vercelignore-'));
  execFileSync('git', ['init', '-q', tmp]);
  fs.copyFileSync(ignoreFile, path.join(tmp, '.gitignore'));
  const out = execFileSync('git', ['check-ignore', '--stdin'], {
    cwd: tmp,
    input: files.join('\n'),
    encoding: 'utf8',
    // check-ignore exits 1 when nothing matches
  // eslint-disable-next-line no-empty-function
  }).toString();
  fs.rmSync(tmp, { recursive: true, force: true });
  return new Set(out.split('\n').filter(Boolean));
}

const all = tracked();
let skip;
try {
  skip = excluded(all);
} catch (err) {
  skip = new Set(); // nothing matched
}
const uploaded = all.filter((f) => !skip.has(f));

// Every JSON the server or build requires must survive the upload.
const required = [];
for (const f of all) {
  if (!f.startsWith('src/')) continue;
  if (!/\.js$/.test(f)) continue;
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  const re = /require\(['"](\.[^'"]+\.json)['"]\)/g;
  let m;
  while ((m = re.exec(src))) {
    required.push(path.relative(root, path.resolve(path.dirname(path.join(root, f)), m[1])));
  }
}

const missing = [...new Set(required)].filter((f) => skip.has(f) || !all.includes(f));

console.log(`tracked: ${all.length}  uploaded: ${uploaded.length}  excluded: ${skip.size}`);
console.log(`required JSON referenced by src: ${[...new Set(required)].length}`);

if (missing.length) {
  console.error('\nFAIL: .vercelignore excludes files the build requires:');
  missing.forEach((f) => console.error('  ' + f));
  console.error('\nAnchor the pattern with a leading slash so it only matches the repo root.');
  process.exit(1);
}

console.log('OK: every JSON the build requires survives .vercelignore');
