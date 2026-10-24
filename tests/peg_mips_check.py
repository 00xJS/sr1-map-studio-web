"""Checks py/peg_mips.py: full mip chains in the textures the exporter writes.

Run from web/:  py -3 tests/peg_mips_check.py   (needs numpy and Pillow)

Without anything set it writes chains for made-up textures (square, wide,
tall, DXT1 and DXT5), decodes every level back from where the layout puts
it and compares it with the level it should be. With SR1_GAME_PACKFILES set
to the game's packfiles folder it reads retail PEGs from
mp_city_stream.vpp_xbox2 and checks that their stored chains sit exactly
where the layout says (level count, frame size, and each level decoded
there matching the base shrunk to that size). With SR1_DATA_PACK set to an
unpacked SR1 Map Studio desktop folder it runs a full export through
web_api.py and checks the map's PEG. Everything is written to a temporary
folder; nothing from the game or the data pack is kept.
"""
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import physics_props  # noqa: E402,F401  (first, like web_api)
import sr_reborn_core as rc  # noqa: E402
import peg_xbox2_beaver as peg  # noqa: E402
import fast_dxt  # noqa: E402
import peg_mips as pm  # noqa: E402
import sr_reborn_bridge as bridge  # noqa: E402

fast_dxt.install()
failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def tiled_offsets(xs, ys, across, pitch):
    """XGAddress2DTiledOffset over arrays of block coordinates (offsets in blocks)."""
    log_bpp = (pitch >> 2) + ((pitch >> 1) >> (pitch >> 2))
    aligned = (across + 31) & ~31
    macro = ((xs >> 5) + (ys >> 5) * (aligned >> 5)) << (log_bpp + 7)
    micro = ((xs & 7) + ((ys & 6) << 2)) << log_bpp
    off = macro + ((micro & ~15) << 1) + (micro & 15) + ((ys & 8) << (3 + log_bpp)) + ((ys & 1) << 4)
    return ((((off & ~511) << 3) + ((off & 448) << 2) + (off & 63) + ((ys & 16) << 7)
             + (((((ys & 8) >> 2) + (xs >> 3)) & 3) << 6)) >> log_bpp)


def decode_level(payload, at, across, offset, width, height, fmt):
    """RGB of one level stored at byte `at` in a surface `across` blocks wide, at block `offset` in it.
    With `across` None the level is read as linear, unswapped blocks (straight from the compressor)."""
    pitch = 8 if fmt == peg.FMT_DXT1 else 16
    bw, bh = max(1, (width + 3) // 4), max(1, (height + 3) // 4)
    ys, xs = np.divmod(np.arange(bw * bh, dtype=np.int64), bw)
    if across is None:
        addr = at + (ys * bw + xs) * pitch
    else:
        addr = at + tiled_offsets(xs + offset[0], ys + offset[1], across, pitch) * pitch
    if addr.max() + pitch > len(payload):
        return None
    raw = np.frombuffer(payload, dtype=np.uint8)
    blocks = raw[addr[:, None] + np.arange(pitch)]
    if across is not None:
        blocks = blocks.reshape(len(addr), pitch // 2, 2)[:, :, ::-1].reshape(len(addr), pitch)   # undo the 16-bit swap
    col = blocks[:, pitch - 8:]
    c0 = col[:, 0].astype(np.int32) | col[:, 1].astype(np.int32) << 8
    c1 = col[:, 2].astype(np.int32) | col[:, 3].astype(np.int32) << 8
    bits = col[:, 4].astype(np.int64) | col[:, 5].astype(np.int64) << 8 | col[:, 6].astype(np.int64) << 16 | col[:, 7].astype(np.int64) << 24

    def rgb(c):
        return np.stack([(c >> 11 & 31) * 255 // 31, (c >> 5 & 63) * 255 // 63, (c & 31) * 255 // 31], 1)
    p0, p1 = rgb(c0), rgb(c1)
    four = (c0 > c1)[:, None] | (fmt != peg.FMT_DXT1)
    pal = np.stack([p0, p1, np.where(four, (2 * p0 + p1) // 3, (p0 + p1) // 2), np.where(four, (p0 + 2 * p1) // 3, 0)], 1)
    idx = (bits[:, None] >> (2 * np.arange(16))) & 3
    px = np.take_along_axis(pal, idx[:, :, None].repeat(3, 2), 1)       # (blocks, 16, 3)
    img = px.reshape(bh, bw, 4, 4, 3).transpose(0, 2, 1, 3, 4).reshape(bh * 4, bw * 4, 3)
    return img[:height, :width].astype(np.float64)


def shrink(img, level):
    """The base shrunk 2^level times by averaging (what each level should look like)."""
    h, w = img.shape[:2]
    fy, fx = min(h, 1 << level), min(w, 1 << level)
    return img[:h // fy * fy, :w // fx * fx].reshape(h // fy, fy, w // fx, fx, 3).mean((1, 3))


def picture(w, h, alpha=False):
    """Big soft shapes (so every level differs from its neighbours and from black) plus a little noise."""
    y, x = np.mgrid[0:h, 0:w] / np.array([h, w])[:, None, None]
    r = 128 + 100 * np.sin(6.3 * x) * np.cos(3.1 * y)
    g = 60 + 150 * (x * y)
    b = 200 - 140 * ((x - 0.5) ** 2 + (y - 0.4) ** 2) ** 0.5
    rgba = np.stack([r, g, b, np.where(x < 0.5, 255, 120) if alpha else np.full_like(x, 255)], -1)
    rgba[..., :3] += np.random.default_rng(w * 7 + h).normal(0, 4, (h, w, 3))
    return Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), 'RGBA')


def units():
    # GetPackedMipOffset, in blocks: square packs along X then Y, wide along Y then X, tall along X then Y.
    check([pm.packed_offset(128, 128, k) for k in (3, 4, 5)] == [(4, 0), (2, 0), (1, 0)], 'tail: 128x128 levels 3-5 at (4,0) (2,0) (1,0)')
    check([pm.packed_offset(256, 64, k) for k in (2, 3, 4, 5, 6)] == [(0, 4), (0, 2), (0, 1), (8, 0), (4, 0)], 'tail: 256x64 stacks down, then across')
    check([pm.packed_offset(32, 128, k) for k in (1, 2, 3, 4, 5)] == [(4, 0), (2, 0), (1, 0), (0, 8), (0, 4)], 'tail: 32x128 across, then down')
    check(pm.packed_offset(128, 128, 2) is None, 'tail: a 32x32 level is not packed')
    check([pm.level_count(*s) for s in ((128, 128), (256, 64), (32, 128), (1024, 1024), (8, 8))] == [6, 7, 6, 9, 2], 'levels down to a 4-texel longest side')
    check(not pm.chained(64, 16) and not pm.chained(16, 16) and pm.chained(32, 32), 'textures 16 texels or less across keep their base level only')
    # Frame sizes of retail chained entries of these shapes (DXT5 with the 8 KB retail 0x20 entries carry).
    sizes = {(128, 128, peg.FMT_DXT1): 32768, (256, 256, peg.FMT_DXT1): 65536, (1024, 1024, peg.FMT_DXT1): 720896,
             (64, 64, peg.FMT_DXT1): 24576, (256, 64, peg.FMT_DXT1): 32768, (32, 128, peg.FMT_DXT1): 16384,
             (128, 128, peg.FMT_DXT5): 73728, (256, 256, peg.FMT_DXT5): 139264, (512, 512, peg.FMT_DXT5): 401408,
             (64, 64, peg.FMT_DXT5): 57344}
    got = {k: pm.layout(*k)[1] for k in sizes}
    check(got == sizes, 'layout: frame sizes match retail chained entries ' + str({k: v for k, v in got.items() if v != sizes[k]}))

    for w, h, fmt in ((128, 128, peg.FMT_DXT1), (256, 64, peg.FMT_DXT1), (32, 128, peg.FMT_DXT1), (64, 64, peg.FMT_DXT5), (512, 256, peg.FMT_DXT5)):
        im = picture(w, h, fmt == peg.FMT_DXT5)
        linear, kind = peg.compress_image_for_format(im, fmt)
        base = peg.swap16(peg.tile_x360(linear, w, h, kind))
        mips, n = pm.mip_payload(im, fmt)
        payload = base + mips
        levels, size = pm.layout(w, h, fmt)
        exact, wrong, shrunk = True, 1e9, 0.0
        for level, at, across, offset in levels:
            lw, lh = max(1, w >> level), max(1, h >> level)
            lv = pm.level_image(im, level)
            want = decode_level(peg.compress_image_for_format(lv, fmt)[0], 0, None, None, lw, lh, fmt)
            got = decode_level(payload, at, across, offset, lw, lh, fmt)
            exact = exact and got is not None and np.array_equal(got, want)
            shrunk = max(shrunk, float(np.abs(np.asarray(lv.convert('RGB'), dtype=np.float64) - shrink(np.asarray(im.convert('RGB'), dtype=np.float64), level)).mean()))
            if level and offset != (0, 0):
                moved = decode_level(payload, at, across, (0, 0), lw, lh, fmt)
                wrong = min(wrong, float(np.abs(moved - want).mean()))
        check(n == len(levels) == pm.level_count(w, h) and len(payload) == size and exact and shrunk < 1 and wrong > 10,
              f'{w}x{h} {"DXT5" if fmt == peg.FMT_DXT5 else "DXT1"}: {n} levels, {len(payload)} bytes, every level reads back exactly '
              f'from where the layout puts it (box-shrunk levels; read from the wrong place, a packed level is off by {wrong:.0f})')
    mips, n = pm.mip_payload(picture(64, 16), peg.FMT_DXT1)
    check((mips, n) == (b'', 1), '64x16: base level only')
    entry = bytearray(peg.ENTRY_SIZE)
    pm.mark(entry, 6, True)
    check((entry[0x14], entry[0x16]) == (0x21, 6), 'entry: chain flag 0x20 with the alpha bit, level count')
    pm.mark(entry, 1, False)
    check((entry[0x14], entry[0x16]) == (0, 1), 'entry: a lone base level as before')


def retail(packfiles, tmp):
    """Retail chains sit exactly where the layout puts them."""
    pk = rc.Packfile(Path(packfiles) / 'mp_city_stream.vpp_xbox2')
    seen = counts = sized = placed = 0
    bad = []
    for name in ('mp_bac_01', 'mp_arena', 'mp_ptp_01', 'mp_bac_03', 'mp_bor_01'):
        if not pk.has(name + '.peg_xbox2'):
            continue
        p = tmp / 'retail.peg'
        p.write_bytes(pk.read(name + '.peg_xbox2'))
        _, _, entries = peg.parse_peg(p)
        for e in entries:
            flags = e.raw[0x14] & ~1
            if e.fmt not in (peg.FMT_DXT1, peg.FMT_DXT5) or flags not in (0, pm.CHAIN) or e.raw[0x16] < 2 or not e.frame_size:
                continue
            if not pm.chained(e.width, e.height) or e.width & (e.width - 1) or e.height & (e.height - 1):
                continue
            seen += 1
            counts += e.raw[0x16] == pm.level_count(e.width, e.height)
            levels, size = pm.layout(e.width, e.height, e.fmt)
            if e.fmt == peg.FMT_DXT5 and flags == 0:
                size -= pm.DXT5_PAD        # only the 0x20 entries carry the padding
            sized += e.frame_size == size
            payload = bytes(e.payload[:e.frame_size])
            base = decode_level(payload, 0, *levels[0][2:], e.width, e.height, e.fmt)
            ok = True
            for level, at, across, offset in levels[1:]:
                lw, lh = max(1, e.width >> level), max(1, e.height >> level)
                got = decode_level(payload, at, across, offset, lw, lh, e.fmt)
                want = shrink(base, level)
                flat = float(np.abs(want - want.mean((0, 1))).mean())
                if got is None or float(np.abs(got - want).mean()) > 0.5 * flat + 6:
                    ok = False
                    break
            placed += ok
            if not ok and len(bad) < 5:
                bad.append(f'{name}:{e.name} {e.width}x{e.height} level {level}')
    pk.close()
    check(seen > 500, f'retail: {seen} chained DXT1/DXT5 textures read')
    check(counts == seen, f'retail: level count is down to a 4-texel side on {counts}/{seen}')
    check(sized == seen, f'retail: frame size equals the layout on {sized}/{seen}')
    check(placed >= 0.97 * seen, f'retail: every level found where the layout puts it on {placed}/{seen} ' + ' '.join(bad))


def full_export(pack, tmp):
    import web_api
    import sr1_native_glass
    import sr1_native_props
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    def box(name, size, mat):
        sx, sy, sz = size
        v = [(x * sx, y * sy, z * sz) for x in (-.5, .5) for y in (0, 1) for z in (-.5, .5)]
        quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (1, 5, 7, 3), (0, 2, 6, 4)]
        lines = [f'v {a} {b} {c}' for a, b, c in v] + ['vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1', f'usemtl {mat}']
        for q in quads:
            lines += [f'f {q[0]+1}/1 {q[1]+1}/2 {q[2]+1}/3', f'f {q[0]+1}/1 {q[2]+1}/3 {q[3]+1}/4']
        (work / name).write_text('\n'.join(lines) + '\n')
        return str(work / name)

    pics = {}
    for key, (w, h, alpha) in {'g': (256, 256, False), 'f': (128, 64, True), 'c': (64, 64, False), 'tiny': (16, 64, False)}.items():
        pics[key] = str(work / (key + '.png'))
        picture(w, h, alpha).save(pics[key])
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static')
    items = [dict(base, name='Ground', path=box('g.obj', (80, 2, 80), 'g'), position=[0, -2, 0], textures={'g': pics['g']}),
             dict(base, name='Fence', path=box('f.obj', (10, 4, 0.2), 'f'), position=[0, 0, 12], textures={'f': pics['f']}, alpha={'f': True}),
             dict(base, name='Trim', path=box('t.obj', (4, 1, 1), 't'), position=[0, 0, -12], textures={'t': pics['tiny']})]
    prop = json.loads(web_api.scene_op('native_prop', json.dumps({'item': dict(base, name='Box', path=box('c.obj', (2, 2, 2), 'c'), position=[6, 0, 6], textures={'c': pics['c']}),
                                                                   'behavior': 'movable', 'world_scale': 0.5, 'others': []})))
    check(prop['ok'], 'export: movable prop made' + ('' if prop['ok'] else ': ' + prop['error']))
    items.append(prop['value'])
    markers = [dict(type='Shared spawn', position=[x, 0.1, 0], yaw=0, label='') for x in (-4, -2, 2, 4)]
    spec = dict(job='m', scene_items=items, markers=markers, lights=[], base_name='mipstest', world_scale=0.5, mirror_x=True,
                flip_obj_v=True, double_sided=False, ptp=False)
    r = json.loads(web_api.export_project(json.dumps(spec), print if os.environ.get('VERBOSE') else (lambda x: None)))
    check(r['ok'], 'export: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
    if not r['ok']:
        return
    out = Path(r['value']['out_dir'])
    _, _, ref = peg.parse_peg(studio / 'reference_beavercreek' / 'beavercreek.peg_xbox2')
    _, _, entries = peg.parse_peg(out / 'mipstest.peg_xbox2')
    ours = entries[len(ref):]
    check([(e.name, e.raw[4:0x34], e.payload) for e in entries[:len(ref)]] == [(e.name, e.raw[4:0x34], e.payload) for e in ref],
          'export: the template\'s own textures are untouched')
    by_size = {(e.width, e.height, e.fmt): e for e in ours}
    want = {(256, 256, peg.FMT_DXT1): 7, (128, 64, peg.FMT_DXT5): 6, (64, 64, peg.FMT_DXT1): 5, (16, 64, peg.FMT_DXT1): 1}
    for key, n in want.items():
        e = by_size.get(key)
        flag = (pm.CHAIN if n > 1 else 0) | (1 if key[2] == peg.FMT_DXT5 else 0)
        check(e is not None and e.raw[0x16] == n and e.raw[0x14] == flag and e.frame_size == pm.layout(*key)[1],
              f'export: {key[0]}x{key[1]} texture written with {n} level(s), flag 0x{flag:02X}, frame {pm.layout(*key)[1]}')
        if e is not None and n > 1:
            levels, _ = pm.layout(*key)
            level, at, across, offset = levels[-1]
            lw, lh = max(1, key[0] >> level), max(1, key[1] >> level)
            got = decode_level(bytes(e.payload), at, across, offset, lw, lh, key[2])
            im, _, _ = bridge.normalized_image(pics[{256: 'g', 128: 'f', 64: 'c'}[key[0]]], key[2] == peg.FMT_DXT5)
            want = decode_level(peg.compress_image_for_format(pm.level_image(im, level), key[2])[0], 0, None, None, lw, lh, key[2])
            check(got is not None and np.array_equal(got, want), f'export: {key[0]}x{key[1]} smallest level ({lw}x{lh}) reads back exactly')
    ch = rc.read_chunk((out / 'mipstest.bbchunk_xbox2').read_bytes())
    check(rc.chunk_strings(ch) == [e.name for e in entries], 'export: chunk textures still match the PEG')


with tempfile.TemporaryDirectory() as t:
    tmp = Path(t)
    units()
    game = os.environ.get('SR1_GAME_PACKFILES')
    if game:
        retail(game, tmp)
    else:
        print('skip retail comparison (set SR1_GAME_PACKFILES to run it)')
    pack = os.environ.get('SR1_DATA_PACK')
    if pack:
        full_export(Path(pack), tmp)
    else:
        print('skip full export (set SR1_DATA_PACK to run it)')

print('\n%d failure(s)' % len(failures))
sys.exit(1 if failures else 0)
