"""Export speed-ups that leave every output byte unchanged.

The exporter spends nearly all of a big map's time on textures: each scene
object names its materials objNNN_<material>, so a sample map with 45 texture
files has ~400 materials, and every one was opened, compressed, tiled and
byte-swapped again. This module, installed over the upstream functions it
replaces (studio-py/ itself is not edited):

- remembers each compressed texture by a hash of its pixels and format, in
  memory and (when a cache folder is set) on disk, so a texture is compressed
  once per device rather than once per material per export. The key includes
  the compressor's source, so a change to fast_dxt.py starts a fresh cache;
- remembers decoded source images by file (path, size, mtime) for the length
  of an export and hands out copy-on-write views, since callers may change them;
- tiles and byte-swaps payloads with numpy instead of a Python loop per block;
- skips the per-material TGA copies export_map writes to <map>_textures_tga
  and deletes again before it returns (nothing reads them).

tests/export_cache_check.py exports a project with and without all of this
and compares the files.
"""
from __future__ import annotations

import hashlib
import os
import time
import weakref
from collections import Counter, OrderedDict
from pathlib import Path

import numpy as np
from PIL import Image

import peg_xbox2_beaver as peg
import sr_reborn_bridge as bridge

# Set by configure(); None keeps the cache in memory only.
CACHE_DIR: Path | None = None
DISK_LIMIT = 192 * 1024 * 1024   # the browser loads the whole cache into memory at start
MEMORY_LIMIT = 128 * 1024 * 1024
IMAGE_LIMIT = 192 * 1024 * 1024

stats = Counter()
_payloads: OrderedDict[str, bytes] = OrderedDict()
_images: OrderedDict[tuple, list] = OrderedDict()   # file key -> [image, source size, size, pixel digest]
_handed = {}                                        # id(copy handed out) -> (weakref to it, file key)
_tiled: OrderedDict[str, tuple] = OrderedDict()
_salt = b''
_original = {}


def configure(cache_dir=None, disk_limit=None):
    global CACHE_DIR, DISK_LIMIT
    CACHE_DIR = Path(cache_dir) if cache_dir else None
    if disk_limit:
        DISK_LIMIT = int(disk_limit)
    if CACHE_DIR:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)


def release():
    """End of an export: let go of decoded images (tens of MB) until the next one."""
    _images.clear()
    _handed.clear()
    import fast_geometry
    fast_geometry._links.clear()


def reset(memory=True):
    """Start an export: forget decoded images (and, if asked, the in-memory payloads)."""
    release()
    if memory:
        _payloads.clear()
        _tiled.clear()
    stats.clear()


# ---------------- compressed texture cache ----------------

def _pixels_digest(img):
    """sha256 of the pixels. An image handed out by normalized_image that
    nobody has changed still shares its source's pixel memory (see there), so
    it reuses the digest worked out for that source: 400 materials hash 45
    images."""
    handed = _handed.get(id(img))
    if handed and handed[0]() is img:
        rec = _images.get(handed[1])
        if rec is not None and img.im is rec[0].im:
            if rec[3] is None:
                rec[3] = hashlib.sha256(rec[0].tobytes()).digest()
            return rec[3]
    return hashlib.sha256(img.tobytes()).digest()


def _key(img, what):
    h = hashlib.sha256(_salt)
    h.update(repr((what, img.mode, img.size)).encode())
    h.update(_pixels_digest(img))
    return h.hexdigest()


def _remember(key, data):
    _payloads[key] = data
    _payloads.move_to_end(key)
    total = sum(len(v) for v in _payloads.values())
    while total > MEMORY_LIMIT and len(_payloads) > 1:
        total -= len(_payloads.popitem(last=False)[1])


def _disk_path(key):
    return CACHE_DIR / key[:2] / (key + '.dxt')


def _load(key):
    data = _payloads.get(key)
    if data is not None:
        _payloads.move_to_end(key)
        stats['memory_hits'] += 1
        return data
    if CACHE_DIR is None:
        return None
    path = _disk_path(key)
    try:
        data = path.read_bytes()
    except OSError:
        return None
    try:
        # Refresh its age for pruning, at most daily (each touch is rewritten to IndexedDB).
        if time.time() - path.stat().st_mtime > 86400:
            os.utime(path)
    except OSError:
        pass
    stats['disk_hits'] += 1
    _remember(key, data)
    return data


def _store(key, data):
    _remember(key, data)
    if CACHE_DIR is None:
        return
    path = _disk_path(key)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix('.tmp')
        tmp.write_bytes(data)
        os.replace(tmp, path)
        stats['disk_writes'] += 1
    except OSError:
        pass


def prune():
    """Keep the disk cache under DISK_LIMIT, dropping the least recently used files."""
    if CACHE_DIR is None or not CACHE_DIR.is_dir():
        return 0
    files = []
    for p in CACHE_DIR.glob('*/*.dxt'):
        try:
            st = p.stat()
        except OSError:
            continue
        files.append((st.st_mtime, st.st_size, p))
    total = sum(f[1] for f in files)
    removed = 0
    for _, size, p in sorted(files):
        if total <= DISK_LIMIT:
            break
        try:
            p.unlink()
            total -= size
            removed += 1
        except OSError:
            pass
    return removed


def compress_image_for_format(img, fmt):
    kind = {peg.FMT_DXT1: 'DXT1', peg.FMT_DXT3: 'DXT3', peg.FMT_DXT5: 'DXT5'}.get(fmt)
    if kind is None:
        return _original['compress_image_for_format'](img, fmt)
    key = _key(img, ('format', fmt))
    data = _load(key)
    if data is None:
        stats['compressed'] += 1
        data, kind = _original['compress_image_for_format'](img, fmt)
        _store(key, data)
    return data, kind


def compress_image(img, kind):
    key = _key(img, ('kind', kind))
    data = _load(key)
    if data is None:
        stats['compressed'] += 1
        data = _original['compress_image'](img, kind)
        _store(key, data)
    return data


def encoded_payload(im, fmt):
    """sr_reborn_bridge._encoded_payload (compress, tile, byte-swap), remembered whole."""
    key = _key(im, ('payload', fmt))
    hit = _tiled.get(key)
    if hit is None:
        hit = _tiled[key] = _original['encoded_payload'](im, fmt)
        total = sum(len(v[0]) for v in _tiled.values())
        while total > MEMORY_LIMIT and len(_tiled) > 1:
            total -= len(_tiled.popitem(last=False)[1][0])
    else:
        _tiled.move_to_end(key)
        stats['payload_hits'] += 1
    return hit


# ---------------- decoded source images ----------------

class _SourceCopy(Image.Image):
    """A copy-on-write view of a decoded texture: it shares the decoded pixels
    and is marked read-only, so Pillow copies them before any in-place change
    (putalpha, paste, ...) and the shared source stays as decoded. export_map saves one TGA per material into
    <map>_textures_tga and removes that folder before returning; those saves
    are skipped. Any other save goes through."""

    def save(self, fp, format=None, **params):
        if format == 'TGA' and isinstance(fp, (str, os.PathLike)) and Path(fp).parent.name.endswith('_textures_tga'):
            stats['tga_skipped'] += 1
            return None
        return super().save(fp, format, **params)


def normalized_image(path, use_alpha=False):
    try:
        st = os.stat(path)
        key = (os.path.abspath(path), st.st_size, st.st_mtime_ns, bool(use_alpha))
    except OSError:
        return _original['normalized_image'](path, use_alpha)
    hit = _images.get(key)
    if hit is None:
        stats['decoded'] += 1
        hit = _images[key] = list(_original['normalized_image'](path, use_alpha)) + [None]
        total = sum(h[0].width * h[0].height * 4 for h in _images.values())
        while total > IMAGE_LIMIT and len(_images) > 1:
            old = _images.popitem(last=False)[1]
            total -= old[0].width * old[0].height * 4
    else:
        _images.move_to_end(key)
    hit[0].load()
    im = hit[0]._new(hit[0].im)
    im.readonly = 1
    im.__class__ = _SourceCopy
    _handed[id(im)] = (weakref.ref(im), key)
    weakref.finalize(im, _handed.pop, id(im), None)
    return im, hit[1], hit[2]


# ---------------- Xbox 360 tiling and byte order ----------------

def _tiled_blocks(bw, bh, pitch):
    """XGAddress2DTiledOffset for every block, in the original's (y, x) loop order."""
    y, x = np.divmod(np.arange(bw * bh, dtype=np.int64), bw)
    aligned_width = (bw + 31) & ~31
    log_bpp = (pitch >> 2) + ((pitch >> 1) >> (pitch >> 2))
    macro = ((x >> 5) + (y >> 5) * (aligned_width >> 5)) << (log_bpp + 7)
    micro = ((x & 7) + ((y & 6) << 2)) << log_bpp
    offset = macro + ((micro & ~15) << 1) + (micro & 15) + ((y & 8) << (3 + log_bpp)) + ((y & 1) << 4)
    return ((((offset & ~511) << 3) + ((offset & 448) << 2) + (offset & 63)
             + ((y & 16) << 7) + (((((y & 8) >> 2) + (x >> 3)) & 3) << 6)) >> log_bpp), x, y


def tile_x360(linear, width, height, kind):
    pitch, bw, bh, aw, ah = peg._block_geometry(width, height, kind)
    if len(linear) != bw * bh * pitch:
        raise RuntimeError('linear BC payload size mismatch')
    dst, x, y = _tiled_blocks(bw, bh, pitch)
    over = np.nonzero(dst * pitch + pitch > aw * ah * pitch)[0]
    if len(over):
        i = over[0]
        raise RuntimeError(f'Xbox tiled address overflow ({x[i]},{y[i]}) -> 0x{int(dst[i]) * pitch:X}')
    out = np.zeros((aw * ah, pitch), dtype=np.uint8)
    # Later blocks win on a shared address, as with the original's in-order writes.
    _, last = np.unique(dst[::-1], return_index=True)
    keep = len(dst) - 1 - last
    out[dst[keep]] = np.frombuffer(bytes(linear), dtype=np.uint8).reshape(-1, pitch)[keep]
    return out.tobytes()


def untile_x360(tiled, width, height, kind):
    pitch, bw, bh, aw, ah = peg._block_geometry(width, height, kind)
    if len(tiled) < aw * ah * pitch:
        raise RuntimeError('tiled BC payload is smaller than the recovered surface extent')
    dst, _, _ = _tiled_blocks(bw, bh, pitch)
    src = np.frombuffer(bytes(tiled), dtype=np.uint8)
    idx = (dst[:, None] * pitch + np.arange(pitch)).reshape(-1)
    return src[idx].tobytes()


def swap16(data):
    a = np.frombuffer(bytes(data), dtype=np.uint8).copy()
    n = len(a) & ~1
    a[:n] = a[:n].reshape(-1, 2)[:, ::-1].reshape(-1)
    return a.tobytes()


def uninstall():
    if not _original:
        return
    peg.compress_image_for_format = _original['compress_image_for_format']
    peg.compress_image = _original['compress_image']
    peg.tile_x360, peg.untile_x360, peg.swap16 = _original['tile_x360'], _original['untile_x360'], _original['swap16']
    bridge.normalized_image = _original['normalized_image']
    bridge._encoded_payload = _original['encoded_payload']
    _original.clear()
    reset()
    import fast_geometry
    fast_geometry.uninstall()


def install(cache_dir=None):
    """Swap in the cached/vectorized functions (after fast_dxt.install())."""
    global _salt
    if cache_dir is not None:
        configure(cache_dir)
    if _original:
        return
    import fast_dxt
    _salt = hashlib.sha256(Path(fast_dxt.__file__).read_bytes()).digest()
    _original.update(compress_image_for_format=peg.compress_image_for_format, compress_image=peg.compress_image,
                     normalized_image=bridge.normalized_image, encoded_payload=bridge._encoded_payload,
                     tile_x360=peg.tile_x360, untile_x360=peg.untile_x360, swap16=peg.swap16)
    peg.compress_image_for_format = compress_image_for_format
    peg.compress_image = compress_image
    peg.tile_x360 = tile_x360
    peg.untile_x360 = untile_x360
    peg.swap16 = swap16
    bridge.normalized_image = normalized_image
    bridge._encoded_payload = encoded_payload
    import fast_geometry
    fast_geometry.install()
