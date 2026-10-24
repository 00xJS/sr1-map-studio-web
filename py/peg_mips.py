"""Full mip chains for the textures the exporter writes into the map's PEG.

Upstream writes every new texture as its base level only (entry +0x16 = 1),
so distant surfaces shimmer and moire. Retail PEGs store the chain down to
4x4 and mark it in the entry: +0x14 = 0x20 (bit 0 = alpha), +0x16 = the
level count. This module, installed over the upstream texture writers
(studio-py/ is not edited), appends the levels in the Xbox 360 layout:

- the base level as before (tiled, padded to 32x32 blocks);
- mip 1 right after it, then each level in its own surface padded to
  32x32 blocks, while its shorter side is above 16 texels;
- the rest in one packed tail surface (the first level whose shorter side
  is 16 or less), each level at the block offset the GPU looks for it. This
  follows GetPackedMipOffset in the ReXGlue SDK's texture/util.cpp.

Textures whose shorter side is 16 texels or less would have their base in
the packed tail too; those keep the single base level, as before.

Retail DXT5 chains marked 0x20 are 8 KB longer than their levels; that
padding is written too, so frame sizes match retail. tests/peg_mips_check.py
checks the layout on made-up textures and, with the game's packfiles, on
retail ones.
"""
from __future__ import annotations

import contextlib

from PIL import Image

import peg_xbox2_beaver as peg
import sr_reborn_bridge as bridge

CHAIN = 0x20             # PEG entry +0x14: mip chain stored (bit 0: alpha)
DXT5_PAD = 0x2000        # retail 0x20 DXT5 chains: 8 KB after the levels
_original = {}


def _log2_ceil(n):
    return max(0, (int(n) - 1).bit_length())


def level_count(width, height):
    """Levels down to a longest side of 4 texels, as retail (128 px: 6)."""
    return max(1, _log2_ceil(max(width, height)) - 1)


def packed_level(width, height):
    """The first level stored in the packed tail (its shorter side is 16 texels or less)."""
    size = _log2_ceil(min(width, height))
    return size - 4 if size > 4 else 0


def packed_offset(width, height, level):
    """(x, y) in 4x4 blocks of `level` inside the packed tail: GetPackedMipOffset for 2D block formats."""
    lw, lh = _log2_ceil(width), _log2_ceil(height)
    size = min(lw, lh)
    if size > 4 + level:
        return None
    base = size - 4 if size > 4 else 0
    m = level - base
    if m < 3:
        x, y = (0, 16 >> m) if lw > lh else (16 >> m, 0)
    elif lw > lh:
        x, y = (1 << (lw - base)) >> (m - 2), 0
    else:
        x, y = 0, (1 << (lh - base)) >> (m - 2)
    return x // 4, y // 4


def chained(width, height):
    return packed_level(width, height) >= 1 and level_count(width, height) > 1


def _blocks(n):
    return max(1, (n + 3) // 4)


def _align32(n):
    return max(32, (n + 31) & ~31)


def level_image(im, level):
    w, h = max(1, im.width >> level), max(1, im.height >> level)
    return im.resize((w, h), Image.Resampling.BOX)


def layout(width, height, fmt):
    """Where each level sits in a chained payload: ([(level, surface byte offset, surface width in blocks,
    (x, y) block offset inside the surface)], total bytes). Level 0 is the base."""
    pitch = 8 if fmt == peg.FMT_DXT1 else 16

    def surface(level):
        return _align32(_blocks(max(1, width >> level))), _align32(_blocks(max(1, height >> level)))
    across, rows = surface(0)
    levels, at = [(0, 0, across, (0, 0))], across * rows * pitch
    if not chained(width, height):
        return levels, at
    n, p = level_count(width, height), packed_level(width, height)
    for level in range(1, min(p, n)):
        across, rows = surface(level)
        levels.append((level, at, across, (0, 0)))
        at += across * rows * pitch
    if n > p:
        across, rows = surface(p)
        levels += [(level, at, across, packed_offset(width, height, level)) for level in range(p, n)]
        at += across * rows * pitch
    if fmt == peg.FMT_DXT5:
        at += DXT5_PAD
    return levels, at


def mip_payload(im, fmt):
    """Levels 1.. of `im` (a power-of-two RGBA image), tiled and byte-swapped like the base; (bytes, level count)."""
    w, h = im.size
    levels, size = layout(w, h, fmt)
    if len(levels) == 1:
        return b'', 1
    pitch = 8 if fmt == peg.FMT_DXT1 else 16
    base = levels[1][1]
    out = bytearray(size - base)
    for level, at, across, (ox, oy) in levels[1:]:
        lv = level_image(im, level)
        linear, kind = peg.compress_image_for_format(lv, fmt)
        bw, bh = _blocks(lv.width), _blocks(lv.height)
        if level < packed_level(w, h):   # a surface of its own
            tiled = peg.tile_x360(linear, lv.width, lv.height, kind)
            out[at - base:at - base + len(tiled)] = tiled
            continue
        rows = _align32(_blocks(max(1, h >> packed_level(w, h))))
        if ox + bw > across or oy + bh > rows:
            raise RuntimeError(f'packed mip {level} of a {w}x{h} texture falls outside its tail')
        for y in range(bh):
            for x in range(bw):
                to = at - base + peg.XGAddress2DTiledOffset(x + ox, y + oy, across, pitch) * pitch
                src = (y * bw + x) * pitch
                out[to:to + pitch] = linear[src:src + pitch]
    return peg.swap16(bytes(out)), len(levels)


def mark(entry, levels, alpha):
    """The directory entry fields for a stored chain (or a lone base level)."""
    entry[0x14] = (CHAIN if levels > 1 else 0) | (1 if alpha else 0)
    entry[0x16] = levels


@contextlib.contextmanager
def _with_mips(made):
    """While it runs, every texture encoded through bridge._encoded_payload gets its levels; `made` lists the counts."""
    encode = bridge._encoded_payload

    def encoded(im, fmt):
        payload, kind = encode(im, fmt)
        mips, levels = mip_payload(im, fmt)
        made.append(levels)
        return payload + mips, kind
    bridge._encoded_payload = encoded
    try:
        yield
    finally:
        bridge._encoded_payload = encode


def append_dynamic_textures(reference_peg, output_peg, items, replace_special=None):
    made = []
    with _with_mips(made):
        report = _original['append'](reference_peg, output_peg, items, replace_special)
    added = report.get('added', [])
    if len(made) != len(added):
        raise RuntimeError('mip chains: texture count mismatch')
    data = bytearray(open(output_peg, 'rb').read())
    for rec, levels in zip(added, made):
        at = peg.HEADER_SIZE + rec['index'] * peg.ENTRY_SIZE
        entry = data[at:at + peg.ENTRY_SIZE]
        mark(entry, levels, rec['use_alpha'])
        data[at:at + peg.ENTRY_SIZE] = entry
        rec['mip_levels'] = levels
    open(output_peg, 'wb').write(bytes(data))
    report['mip_levels'] = sum(1 for n in made if n > 1)
    return report


def encode_custom_texture(donor_entry, image_path, target_name, use_alpha, opacity=None):
    """sr1_native_glass._encode_custom_texture (props, breakables, custom glass), with the chain."""
    made = []
    with _with_mips(made):
        record, payload = _original['custom'](donor_entry, image_path, target_name, use_alpha, opacity)
    if made:
        mark(record, made[-1], use_alpha)
    return record, payload


def install():
    if _original:
        return
    import sr1_native_glass
    _original.update(append=bridge.append_dynamic_textures, custom=sr1_native_glass._encode_custom_texture)
    bridge.append_dynamic_textures = append_dynamic_textures
    sr1_native_glass._encode_custom_texture = encode_custom_texture


def uninstall():
    if _original:
        import sr1_native_glass
        bridge.append_dynamic_textures = _original['append']
        sr1_native_glass._encode_custom_texture = _original['custom']
        _original.clear()
