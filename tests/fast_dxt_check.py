"""Checks py/fast_dxt.py against the original compressor, byte for byte.

Run from web/:  py -3 tests/fast_dxt_check.py   (needs numpy and Pillow)
"""
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402

original_fmt, original_img = peg.compress_image_for_format, peg.compress_image
rng = np.random.default_rng(7)


def images():
    yield 'noise 64', Image.fromarray(rng.integers(0, 256, (64, 64, 4), dtype=np.uint8), 'RGBA')
    yield 'odd 37x22', Image.fromarray(rng.integers(0, 256, (22, 37, 4), dtype=np.uint8), 'RGBA')
    flat = np.zeros((32, 32, 4), np.uint8); flat[...] = (255, 255, 255, 255)
    yield 'flat white', Image.fromarray(flat, 'RGBA')
    flat[...] = (0, 0, 0, 0)
    yield 'flat clear', Image.fromarray(flat, 'RGBA')
    g = np.zeros((48, 48, 4), np.uint8); g[..., 0] = np.arange(48)[None, :] * 5; g[..., 1] = np.arange(48)[:, None] * 5; g[..., 3] = 128
    yield 'gradient', Image.fromarray(g, 'RGBA')
    # Equal-endpoint edge cases near 565 white.
    e = np.zeros((8, 8, 4), np.uint8); e[...] = (255, 255, 252, 255); e[0, 0] = (255, 255, 255, 255)
    yield 'near white', Image.fromarray(e, 'RGBA')
    tex = root / 'public' / 'textures' / 'red_brick.jpg'
    if tex.exists():
        yield 'red_brick 256', Image.open(tex).convert('RGBA').resize((256, 256))


ok = True
for name, im in images():
    for fmt in (peg.FMT_DXT1, peg.FMT_DXT3, peg.FMT_DXT5):
        t = time.time(); a = original_fmt(im, fmt); t1 = time.time() - t
        t = time.time(); b = fast_dxt.compress_image_for_format(im, fmt); t2 = time.time() - t
        same = a == b
        ok &= same
        print(f'{name:14} fmt {fmt:#06x}: {"identical" if same else "DIFFERENT"}  ({t1:.2f}s -> {t2:.3f}s)')
    for kind in ('DXT1', 'DXT5'):
        same = original_img(im, kind) == fast_dxt.compress_image(im, kind)
        ok &= same
        if not same:
            print(f'{name:14} compress_image {kind}: DIFFERENT')
print('ALL IDENTICAL' if ok else 'MISMATCH')
sys.exit(0 if ok else 1)
