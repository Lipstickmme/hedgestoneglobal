'use strict';

/**
 * Build every brand asset from the supplied logo artwork.
 *
 *   npm run build:brand
 *
 * The source is public/assets/img/rockfieldlogo.png: black line work on an
 * opaque white square, which is the wrong shape for most of the places it has
 * to appear. This turns it into the set the site actually needs -
 *
 *   logo-dark.png      the full lockup, transparent, for light backgrounds
 *   logo-light.png     the same painted white, for the navy panels
 *   logomark-dark.png  the rock and hall alone, for square and compact spots
 *   logomark-light.png the same in white
 *   favicon.png / apple-touch-icon.png / favicon.ico / og-image.png
 *
 * - and does it by reading pixels in Chromium, which is the only image
 * toolchain this project can assume and the same one the browser tests use.
 * Nothing here runs on a normal build: the outputs are committed, because they
 * change about as often as the bank changes its name.
 *
 * Transparency is derived from luminance rather than keyed on pure white, so
 * the anti-aliased edges of the line work stay soft instead of turning into a
 * ragged one-bit cutout.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const BRAND = path.join(PUBLIC, 'assets', 'bank');
const SOURCE = path.join(PUBLIC, 'assets', 'img', 'rockfieldlogo.png');

const NAVY = '#11213a';
const BRASS_LIGHT = '#caa062';
const PAPER = '#ffffff';

/* ------------------------------------------------------------ in-page -- */

/**
 * Runs inside Chromium, where there is a canvas to read pixels from.
 *
 * Returns the cut-outs as data URLs plus the row profile used to find the
 * gap between the mark and the wordmark, so the caller can report it.
 */
async function extract(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const { width, height } = img;
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, width, height);
  const px = src.data;

  // Luminance -> coverage. The artwork is dark on white, so ink is 1 - luma.
  const cover = new Float32Array(width * height);
  for (let i = 0, p = 0; i < px.length; i += 4, p += 1) {
    const luma = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) / 255;
    cover[p] = 1 - luma;
  }

  // Anything under this is paper texture or JPEG-ish noise, not ink.
  const FLOOR = 0.06;
  const rows = new Float32Array(height);
  const cols = new Float32Array(width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = cover[y * width + x];
      if (a > FLOOR) { rows[y] += a; cols[x] += a; }
    }
  }

  const firstAbove = (arr, from, to, step) => {
    for (let i = from; step > 0 ? i < to : i > to; i += step) if (arr[i] > 0.5) return i;
    return -1;
  };

  const top = firstAbove(rows, 0, height, 1);
  const bottom = firstAbove(rows, height - 1, -1, -1);
  const left = firstAbove(cols, 0, width, 1);
  const right = firstAbove(cols, width - 1, -1, -1);

  /** Cut a box out of the coverage map and paint it in one colour. */
  function cut(box, colour, pad = 0) {
    const w = box.right - box.left + 1 + pad * 2;
    const h = box.bottom - box.top + 1 + pad * 2;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const dest = octx.createImageData(w, h);
    const [r, g, b] = colour;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const sx = box.left - pad + x;
        const sy = box.top - pad + y;
        const inside = sx >= 0 && sx < width && sy >= 0 && sy < height;
        const a = inside ? cover[sy * width + sx] : 0;
        const o = (y * w + x) * 4;
        dest.data[o] = r;
        dest.data[o + 1] = g;
        dest.data[o + 2] = b;
        // Push the midtones up a little: the source is soft line art and a
        // straight luminance map renders it noticeably lighter than the
        // original looks on white.
        dest.data[o + 3] = Math.round(Math.min(1, a < FLOOR ? 0 : a * 1.12) * 255);
      }
    }
    octx.putImageData(dest, 0, 0);
    return out.toDataURL('image/png');
  }

  // The mark sits above the wordmark with a band of clear paper between them.
  // Find the widest such band in the top two thirds and cut there.
  let gapStart = -1;
  let best = null;
  for (let y = top; y <= bottom; y += 1) {
    const empty = rows[y] <= 0.5;
    if (empty && gapStart === -1) gapStart = y;
    if ((!empty || y === bottom) && gapStart !== -1) {
      const run = { from: gapStart, to: y - 1 };
      const span = run.to - run.from;
      const inTopTwoThirds = run.from < top + (bottom - top) * 0.7;
      if (inTopTwoThirds && (!best || span > best.to - best.from)) best = run;
      gapStart = -1;
    }
  }
  const split = best ? Math.round((best.from + best.to) / 2) : Math.round((top + bottom) / 2);

  // The mark's own left/right bounds, which are narrower than the wordmark's.
  let markLeft = width;
  let markRight = 0;
  for (let y = top; y < split; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cover[y * width + x] > FLOOR) {
        if (x < markLeft) markLeft = x;
        if (x > markRight) markRight = x;
      }
    }
  }

  const full = { top, bottom, left, right };
  const mark = { top, bottom: split, left: markLeft, right: markRight };

  // The portico alone, thickened, for the small icons.
  //
  // Two problems at favicon sizes, and they need different answers. The whole
  // mark has too much in it: a rock and a building side by side become two
  // grey lumps once there are only sixteen pixels to share between them. And
  // the drawing is fine line work - the strokes are about one part in seventy
  // of its height, so at 16px they are a fifth of a pixel and vanish.
  //
  // So: crop to the hall, and dilate before the browser scales it down. The
  // dilation is sized so the strokes land near a whole pixel in the output,
  // which also closes the gaps between the columns - at 16px a solid portico
  // is the right answer, and at 48px they separate again on their own.
  //
  // The hall's left edge is the low point of the roofline: the rock's summit
  // is higher than the pediment, so the search starts to the right of it and
  // walks left until the roof stops descending.
  const markWidth = markRight - markLeft + 1;
  // Where the hall sits inside the mark.
  //
  // Measured off the artwork rather than detected, because it cannot be
  // detected from the outline: the rock stands behind the hall and is taller,
  // so the silhouette above the hall belongs to the rock, and a skyline search
  // finds the rock's summit every time. These two fractions are checked by eye
  // against the rendered icons - if the logo is ever redrawn, look at
  // favicon.ico afterwards.
  const HALL = { left: 0.50, top: 0.17 };
  const markHeight = split - top;
  const hall = {
    top: Math.round(top + markHeight * HALL.top),
    bottom: split,
    left: Math.round(markLeft + markWidth * HALL.left),
    right: markRight,
  };

  /**
   * A max filter over the coverage map, run separately in each axis.
   *
   * Thickens every stroke by `radius` in all directions. Separable because a
   * square max filter is the horizontal one followed by the vertical one, and
   * doing it in two passes is O(n·r) rather than O(n·r²).
   */
  function dilated(box, radius) {
    const w = box.right - box.left + 1;
    const h = box.bottom - box.top + 1;
    const a = new Float32Array(w * h);
    const b = new Float32Array(w * h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const sx = box.left + x;
        const sy = box.top + y;
        a[y * w + x] = sx >= 0 && sx < width && sy >= 0 && sy < height ? cover[sy * width + sx] : 0;
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let m = 0;
        for (let d = -radius; d <= radius; d += 1) {
          const xx = x + d;
          if (xx >= 0 && xx < w) m = Math.max(m, a[y * w + xx]);
        }
        b[y * w + x] = m;
      }
    }
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        let m = 0;
        for (let d = -radius; d <= radius; d += 1) {
          const yy = y + d;
          if (yy >= 0 && yy < h) m = Math.max(m, b[yy * w + x]);
        }
        a[y * w + x] = m;
      }
    }
    return { data: a, w, h };
  }

  /** Paint a dilated box into a PNG, in one colour. */
  function cutThick(box, colour, radius, pad) {
    const { data, w, h } = dilated(box, radius);
    const out = document.createElement('canvas');
    out.width = w + pad * 2;
    out.height = h + pad * 2;
    const octx = out.getContext('2d');
    const dest = octx.createImageData(out.width, out.height);
    const [r, g, bl] = colour;
    for (let y = 0; y < out.height; y += 1) {
      for (let x = 0; x < out.width; x += 1) {
        const sx = x - pad;
        const sy = y - pad;
        const v = sx >= 0 && sx < w && sy >= 0 && sy < h ? data[sy * w + sx] : 0;
        const o = (y * out.width + x) * 4;
        dest.data[o] = r;
        dest.data[o + 1] = g;
        dest.data[o + 2] = bl;
        dest.data[o + 3] = Math.round(Math.min(1, v < FLOOR ? 0 : v * 1.35) * 255);
      }
    }
    octx.putImageData(dest, 0, 0);
    return out.toDataURL('image/png');
  }

  // One crop per icon size, each thickened for the scale it will be seen at.
  const hallHeight = hall.bottom - hall.top + 1;
  const hallFor = {};
  for (const size of [48, 32, 16]) {
    const radius = Math.max(1, Math.round((hallHeight / size) * 0.6));
    hallFor[size] = cutThick(hall, [255, 255, 255], radius, 8);
  }

  return {
    bounds: { full, mark, hall, split },
    logoDark: cut(full, [17, 33, 58]),
    logoLight: cut(full, [255, 255, 255]),
    markDark: cut(mark, [17, 33, 58]),
    markLight: cut(mark, [255, 255, 255]),
    hallFor,
  };
}

/* ---------------------------------------------------------------- ICO -- */

/**
 * Wrap PNGs in an ICO container.
 *
 * The format allows a PNG payload per entry rather than a bitmap, which every
 * browser since IE11 reads, and which saves writing a BMP encoder by hand.
 * Layout: a 6-byte directory header, one 16-byte entry per image, then the
 * payloads. A size of 256 is written as 0, which is the format's way of
 * saying "not 1..255".
 */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = [];
  const payloads = [];

  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    payloads.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...entries, ...payloads]);
}

/* ---------------------------------------------------------------- run -- */

const dataUrlToBuffer = (url) => Buffer.from(url.split(',')[1], 'base64');

/** The icon tile: the mark in white on a navy square. */
function iconHtml(size, art) {
  // Below 64px the whole mark has no room to resolve, so the tile shows the
  // portico alone - and gives it more of the tile, because there is less in it.
  const small = size < 64;
  const inset = Math.round(size * (small ? 0.08 : 0.15));
  const src = small ? art.hallFor[size] : art.markLight;
  return `<!doctype html><html><body style="margin:0">
    <div style="width:${size}px;height:${size}px;background:${NAVY};border-radius:${Math.round(size * 0.22)}px;
                display:flex;align-items:center;justify-content:center;box-sizing:border-box;padding:${inset}px">
      <img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain" />
    </div>
  </body></html>`;
}

/** The link card: what a shared URL unfurls into. */
function cardHtml(logoLightUrl) {
  return `<!doctype html><html><body style="margin:0">
    <div style="width:1200px;height:630px;background:${NAVY};position:relative;overflow:hidden;
                display:flex;flex-direction:column;align-items:center;justify-content:center;
                font-family:Georgia,'Liberation Serif','Times New Roman',serif">
      <div style="position:absolute;inset:0;
                  background:radial-gradient(60% 50% at 78% 12%, rgba(176,131,65,.30), transparent 70%),
                             radial-gradient(50% 45% at 8% 92%, rgba(41,74,119,.55), transparent 70%)"></div>

      <img src="${logoLightUrl}" style="position:relative;width:560px;object-fit:contain" />

      <div style="position:relative;color:#c3d0e2;font-size:30px;margin-top:34px">Banking built on bedrock.</div>

      <div style="position:absolute;bottom:40px;color:#7f91ab;
                  font-family:Helvetica,'Liberation Sans',Arial,sans-serif;font-size:16px;letter-spacing:3px">
        MEMBER FDIC &middot; EQUAL HOUSING LENDER
      </div>
    </div>
  </body></html>`;
}

(async () => {
  if (!fs.existsSync(SOURCE)) {
    console.error(`[brand] ${path.relative(ROOT, SOURCE)} is missing. That file is the logo; nothing here can be built without it.`);
    process.exit(1);
  }
  fs.mkdirSync(BRAND, { recursive: true });

  let chromium;
  try {
    ({ chromium } = require('playwright-core'));
  } catch (err) {
    console.error('[brand] playwright-core is not installed. npm i -D playwright-core, then run this again.');
    process.exit(1);
  }

  const executablePath = ['/opt/pw-browsers/chromium', '/usr/bin/chromium', '/usr/bin/google-chrome']
    .concat(process.env.CHROME_PATH || [])
    .find((candidate) => { try { return fs.existsSync(candidate); } catch (e) { return false; } });

  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  try {
    const page = await browser.newPage();
    const sourceUrl = `data:image/png;base64,${fs.readFileSync(SOURCE).toString('base64')}`;
    const cut = await page.evaluate(extract, sourceUrl);
    await page.close();

    const { full, mark, split } = cut.bounds;
    console.log(`  read ${path.relative(PUBLIC, SOURCE)}`);
    console.log(`  artwork occupies x ${full.left}-${full.right}, y ${full.top}-${full.bottom}; mark/wordmark split at y ${split}`);
    console.log(`  portico cropped at x ${cut.bounds.hall.left}-${cut.bounds.hall.right}, y ${cut.bounds.hall.top}-${cut.bounds.hall.bottom}`);

    const files = [
      ['logo-dark.png', cut.logoDark],
      ['logo-light.png', cut.logoLight],
      ['logomark-dark.png', cut.markDark],
      ['logomark-light.png', cut.markLight],
    ];
    for (const [name, url] of files) {
      const buf = dataUrlToBuffer(url);
      fs.writeFileSync(path.join(BRAND, name), buf);
      console.log(`  wrote assets/bank/${name} (${(buf.length / 1024).toFixed(1)}kB)`);
    }

    const shoot = async (html, width, height) => {
      const p = await browser.newPage({ viewport: { width, height } });
      await p.setContent(html);
      const buffer = await p.screenshot({ omitBackground: true });
      await p.close();
      return buffer;
    };

    const icons = {};
    for (const size of [512, 180, 48, 32, 16]) {
      icons[size] = await shoot(iconHtml(size, cut), size, size);
      console.log(`  rendered ${size}x${size} icon (${(icons[size].length / 1024).toFixed(1)}kB)`);
    }
    fs.writeFileSync(path.join(PUBLIC, 'favicon.png'), icons[512]);
    fs.writeFileSync(path.join(PUBLIC, 'apple-touch-icon.png'), icons[180]);
    fs.writeFileSync(path.join(BRAND, 'icon-512.png'), icons[512]);
    fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), ico([16, 32, 48].map((size) => ({ size, png: icons[size] }))));

    const card = await shoot(cardHtml(cut.logoLight), 1200, 630);
    fs.writeFileSync(path.join(BRAND, 'og-image.png'), card);
    console.log(`  wrote assets/bank/og-image.png (${(card.length / 1024).toFixed(1)}kB)`);
  } finally {
    await browser.close();
  }

  console.log('[brand] done');
})().catch((err) => {
  console.error('[brand] failed:', err);
  process.exit(1);
});
