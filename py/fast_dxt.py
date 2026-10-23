"""Vectorized DXT1/3/5 compression, byte-identical to peg_xbox2_beaver.

The original compresses one 4x4 block at a time in pure Python (about 15 s for
a 1024x1024 texture on desktop, several times that in the browser). This does
the same arithmetic for all blocks at once with numpy: same candidate
endpoints, same 565 quantization and tie-breaking (first index wins, as with
Python's min/max), same palettes, same bit packing. install() swaps the two
module-level entry points the exporter calls; tests check equality.

Everything is integer arithmetic, so 32-bit integers (largest value: a block's
summed squared error, under 2**22) and working through the blocks a slice at a
time give the same bytes as wider types in one go, with far less memory
traffic.
"""
import numpy as np

import peg_xbox2_beaver as peg


CHUNK = 4096   # blocks per slice


def _blocks(img):
    """(N, 16, 4) int32 blocks in the original's order, edges clamped."""
    a = np.asarray(img.convert('RGBA'), dtype=np.int32)
    h, w = a.shape[:2]
    bh, bw = max(1, (h + 3) // 4), max(1, (w + 3) // 4)
    ys = np.minimum(np.arange(bh * 4), h - 1)
    xs = np.minimum(np.arange(bw * 4), w - 1)
    g = a[ys][:, xs]                                  # (bh*4, bw*4, 4)
    g = g.reshape(bh, 4, bw, 4, 4).transpose(0, 2, 1, 3, 4)
    return g.reshape(bh * bw, 16, 4)


def _rgb565(c):
    return ((c[0] >> 3) << 11) | ((c[1] >> 2) << 5) | (c[2] >> 3)


def _un565(v):
    return ((v >> 11) & 31) * 255 // 31, ((v >> 5) & 63) * 255 // 63, (v & 31) * 255 // 31


def _pick(planes, idx):
    return planes[:, np.arange(planes.shape[1]), idx]


def _score(planes, rgb0, rgb1):
    """planes: (3, N, 16) colour channels; rgb0/rgb1: (3, N) endpoint candidates."""
    c0, c1 = _rgb565(rgb0), _rgb565(rgb1)
    eq = c0 == c1
    inc = eq & (c0 < 65535)
    c0, c1 = np.where(inc, c0 + 1, c0), np.where(eq & ~inc, c1 - 1, c1)
    swap = c0 < c1
    c0, c1 = np.where(swap, c1, c0), np.where(swap, c0, c1)
    p0, p1 = _un565(c0), _un565(c1)
    pal = [(p0[ch], p1[ch], (2 * p0[ch] + p1[ch]) // 3, (p0[ch] + 2 * p1[ch]) // 3) for ch in range(3)]
    # Nearest palette entry per pixel; a strict < keeps the first on ties, like argmin.
    best = j = None
    for k in range(4):
        d = 0
        for ch in range(3):
            diff = planes[ch] - pal[ch][k][:, None]
            d = d + diff * diff                                                 # (N, 16)
        if best is None:
            best, j = d, np.zeros(d.shape, np.uint32)
        else:
            closer = d < best
            best = np.where(closer, d, best)
            j[closer] = k
    err = best.sum(-1)
    bits = (j << (2 * np.arange(16, dtype=np.uint32))).sum(-1, dtype=np.uint32)
    return err, c0, c1, bits


def _sliced(fn):
    def run(b):
        if len(b) <= CHUNK:
            return fn(b)
        return np.concatenate([fn(b[i:i + CHUNK]) for i in range(0, len(b), CHUNK)])
    return run


@_sliced
def _dxt1(b):
    planes = np.ascontiguousarray(b[:, :, :3].transpose(2, 0, 1))             # (3, N, 16)
    lo, hi = planes.min(2), planes.max(2)
    err, c0, c1, bits = _score(planes, hi, lo)
    multi = (planes != planes[:, :, :1]).any(axis=(0, 2))
    if multi.any():
        def dist(ref):
            diff = planes - ref[:, :, None]
            return (diff * diff).sum(0)
        a = _pick(planes, dist(lo).argmax(1))
        bb = _pick(planes, dist(a).argmax(1))
        a = _pick(planes, dist(bb).argmax(1))
        err2, d0, d1, bits2 = _score(planes, a, bb)
        better = multi & (err2 < err)
        c0, c1, bits = np.where(better, d0, c0), np.where(better, d1, c1), np.where(better, bits2, bits)
    out = np.zeros(len(b), dtype=[('c0', '<u2'), ('c1', '<u2'), ('bits', '<u4')])
    out['c0'], out['c1'], out['bits'] = c0, c1, bits
    return out.view(np.uint8).reshape(len(b), 8)


@_sliced
def _dxt5_alpha(b):
    al = np.ascontiguousarray(b[:, :, 3])
    a0, a1 = al.max(1), al.min(1)
    eq = a0 == a1
    a1 = np.where(eq, np.where(a0 != 0, 0, 255), a1)
    swap = a0 < a1
    a0, a1 = np.where(swap, a1, a0), np.where(swap, a0, a1)
    # After the adjustments a0 > a1 always holds, so the 8-value palette applies.
    pal = np.stack([a0, a1] + [((7 - i) * a0 + (i - 1) * a1) // 7 for i in range(2, 8)], axis=1)
    q = np.abs(al[:, :, None] - pal[:, None, :]).argmin(-1)
    bits = (q.astype(np.uint64) << (3 * np.arange(16, dtype=np.uint64))).sum(-1)
    out = np.zeros((len(b), 8), dtype=np.uint8)
    out[:, 0], out[:, 1] = a0, a1
    for k in range(6):
        out[:, 2 + k] = (bits >> np.uint64(8 * k)) & np.uint64(255)
    return out


def _dxt3_alpha(b):
    a = np.clip((b[:, :, 3] + 8) // 17, 0, 15).astype(np.uint64)
    bits = (a << (4 * np.arange(16, dtype=np.uint64))).sum(-1)
    return bits.astype('<u8').view(np.uint8).reshape(len(b), 8)


def compress_image_for_format(img, fmt):
    b = _blocks(img)
    if fmt == peg.FMT_DXT1:
        return _dxt1(b).tobytes(), 'DXT1'
    if fmt == peg.FMT_DXT3:
        return np.concatenate([_dxt3_alpha(b), _dxt1(b)], 1).tobytes(), 'DXT3'
    if fmt == peg.FMT_DXT5:
        return np.concatenate([_dxt5_alpha(b), _dxt1(b)], 1).tobytes(), 'DXT5'
    raise RuntimeError(f'unsupported fixed Beaver texture format 0x{fmt:04X}')


def compress_image(img, kind):
    b = _blocks(img)
    if kind == 'DXT1':
        return _dxt1(b).tobytes()
    return np.concatenate([_dxt5_alpha(b), _dxt1(b)], 1).tobytes()


def install():
    peg.compress_image_for_format = compress_image_for_format
    peg.compress_image = compress_image
