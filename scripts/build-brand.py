"""
Build every brand asset from the supplied logo artwork.

    npm run build:brand        (python3 scripts/build-brand.py)

The source is public/assets/img/hedgestonelogo.png: the green H mark and the
navy HEDGESTONE / GLOBAL BANK wordmark on an opaque white canvas. This cuts it
into the set the site needs:

    logo-dark.png       full lockup, transparent, for light backgrounds
    logo-light.png      the same with the wordmark in white, for dark panels
    logomark-dark.png   the H alone
    logomark-light.png  the H, lifted for dark panels
    favicon.png / icon-512.png / apple-touch-icon.png / favicon.ico
    og-image.png        the card a shared link unfurls into

Transparency comes from each pixel's distance from the white ground, with a
steep ramp so the solid colours stay fully opaque (the mint stripe in the mark
is pale, and a linear ramp would turn it see-through) while anti-aliased edges
stay soft. Colour is un-premultiplied against white so edges do not halo.

Needs Pillow and numpy. The outputs are committed; this only runs when the
logo changes.
"""
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, 'public')
BRAND = os.path.join(PUBLIC, 'assets', 'bank')
SOURCE = os.path.join(PUBLIC, 'assets', 'img', 'hedgestonelogo.png')
FONT = os.path.join(PUBLIC, 'assets', 'fonts', 'plus-jakarta-sans-600-latin.woff2')

GREEN = (11, 93, 72)
INK = (12, 29, 74)
PAPER = (247, 251, 249)


def cutout(rgb):
    """RGB on white -> straight-alpha RGBA."""
    a = rgb.astype(float)
    dev = 255 - a.min(axis=2)
    alpha = np.clip((dev - 10) / 45.0, 0, 1)
    safe = np.maximum(alpha, 1e-3)[..., None]
    col = np.clip((a - (1 - alpha[..., None]) * 255) / safe, 0, 255)
    col[alpha < 1e-3] = 0
    return np.dstack([col, alpha * 255]).astype(np.uint8)


def bbox(rgba, pad=0):
    ys, xs = np.where(rgba[..., 3] > 8)
    return max(xs.min() - pad, 0), max(ys.min() - pad, 0), xs.max() + 1 + pad, ys.max() + 1 + pad


def crop(rgba, box):
    x0, y0, x1, y1 = box
    return rgba[y0:y1, x0:x1].copy()


def is_wordmark(rgba):
    """The navy type is the only ink whose blue channel beats its green."""
    c = rgba[..., :3].astype(int)
    return (c[..., 2] >= c[..., 1]) & (rgba[..., 3] > 0)


def lighten(rgba, amount):
    out = rgba.copy()
    c = out[..., :3].astype(float)
    out[..., :3] = (c + (255 - c) * amount).astype(np.uint8)
    return out


def on_dark(rgba):
    """The H for dark grounds: white and mint, the way the app icon draws it."""
    out = rgba.copy()
    lum = out[..., :3].astype(float).mean(axis=2)
    t = np.clip((lum - 40) / 100, 0, 1)[..., None]
    white = np.array([255, 255, 255], float)
    mint = np.array([170, 233, 208], float)
    out[..., :3] = (white * (1 - t) + mint * t).astype(np.uint8)
    return out


def save(arr, name, height=None):
    im = Image.fromarray(arr, 'RGBA')
    if height:
        im = im.resize((round(im.width * height / im.height), height), Image.LANCZOS)
    im.save(os.path.join(BRAND, name), optimize=True)
    print(f'  wrote assets/bank/{name} ({im.width}x{im.height})')
    return im


def icon(mark, size, radius_frac=0.22, pad_frac=0.2):
    """White H on a green rounded square."""
    tile = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(tile).rounded_rectangle((0, 0, size - 1, size - 1), round(size * radius_frac), fill=GREEN + (255,))
    m = Image.fromarray(mark, 'RGBA')
    inner = round(size * (1 - 2 * pad_frac))
    scale = inner / max(m.width, m.height)
    m = m.resize((max(1, round(m.width * scale)), max(1, round(m.height * scale))), Image.LANCZOS)
    a = np.asarray(m).copy()
    # Keep the two tones of the H as white and mint so it still reads as folded.
    lum = a[..., :3].astype(float).mean(axis=2)
    white = np.array([255, 255, 255], float)
    mint = np.array([170, 233, 208], float)
    t = np.clip((lum - 40) / 100, 0, 1)[..., None]
    a[..., :3] = (white * (1 - t) + mint * t).astype(np.uint8)
    m = Image.fromarray(a, 'RGBA')
    tile.alpha_composite(m, ((size - m.width) // 2, (size - m.height) // 2))
    return tile


def main():
    src = np.asarray(Image.open(SOURCE).convert('RGB'))
    print(f'[brand] read {os.path.relpath(SOURCE, ROOT)} {src.shape[1]}x{src.shape[0]}')
    rgba = cutout(src)

    full = crop(rgba, bbox(rgba, pad=4))
    # The mark is the first run of inked columns from the left.
    cols = (full[..., 3] > 8).any(axis=0)
    x = 0
    while x < len(cols) and not cols[x]:
        x += 1
    while x < len(cols) and cols[x]:
        x += 1
    mark = full[:, :x + 4]
    mark = crop(mark, bbox(mark, pad=4))

    save(full, 'logo-dark.png', height=160)
    light = on_dark(full)
    wm = is_wordmark(full)
    light[wm, 0:3] = 255
    save(light, 'logo-light.png', height=160)
    save(mark, 'logomark-dark.png', height=160)
    save(on_dark(mark), "logomark-light.png", height=160)

    for size, name in [(512, 'icon-512.png'), (512, '../../favicon.png'), (180, '../../apple-touch-icon.png')]:
        icon(mark, size).save(os.path.join(BRAND, name), optimize=True)
        print(f'  wrote {os.path.normpath(os.path.join("assets/bank", name))} ({size}x{size})')
    icon(mark, 256).save(os.path.join(PUBLIC, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
    print('  wrote favicon.ico')

    # Link card: the lockup on pale paper, a soft green field behind it.
    W, H = 1200, 630
    card = Image.new('RGBA', (W, H), PAPER + (255,))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    d.ellipse((760, -220, 1420, 440), fill=(46, 170, 130, 70))
    d.ellipse((-260, 330, 380, 900), fill=(11, 93, 72, 45))
    card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    lock = Image.fromarray(full, 'RGBA')
    lock = lock.resize((760, round(lock.height * 760 / lock.width)), Image.LANCZOS)
    card.alpha_composite(lock, ((W - lock.width) // 2, 190))
    d = ImageDraw.Draw(card)
    f = ImageFont.truetype(FONT, 34)
    tag = 'More control. More possibilities.'
    d.text(((W - d.textlength(tag, font=f)) / 2, 400), tag, font=f, fill=INK + (255,))
    f2 = ImageFont.truetype(FONT, 16)
    foot = 'MEMBER FDIC  ·  EQUAL HOUSING LENDER'
    d.text(((W - d.textlength(foot, font=f2)) / 2, 560), foot, font=f2, fill=(90, 120, 110, 255))
    card.convert('RGB').save(os.path.join(BRAND, 'og-image.png'), optimize=True)
    print('  wrote assets/bank/og-image.png')
    print('[brand] done')


if __name__ == '__main__':
    main()
