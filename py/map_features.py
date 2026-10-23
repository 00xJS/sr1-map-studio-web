"""Extra map features added to an exported map after the main exporter runs.

The upstream exporter (studio-py) is left untouched; web_api.py calls these
helpers on its output files:

- Swimmable water: water volumes written into the map's .bbchunk_xbox2.
- Breakable / weight presets: the stock damage profile named on each native
  object (the game looks the name up in its own table of object profiles).
- Loading screen: levels/ld-<map>.peg_xbox2, one 1280x720 DXT1 picture.
- Background sound: an include line in the map's CTS that borrows the sound
  file of one of the game's own multiplayer maps.

None of this has been tried in game yet.
"""
from __future__ import annotations

import hashlib
import math
import re
import struct
from pathlib import Path

import sr_reborn_core as rc
import peg_xbox2_beaver as peg

# ---------------------------------------------------------------- water --

# The game keeps a small shared pool of water bodies; stay well under it.
MAX_WATER_VOLUMES = 16
# A water volume reaches at least this far (metres) below its surface, so a
# swimmer who bobs or jumps still counts as being in the water.
MIN_WATER_DEPTH = 2.0
# Smallest useful water area, metres per side.
MIN_WATER_SIDE = 0.5
# Texture suffix the game reads as the "water" surface.
WATER_SURFACE_ID = 20
# Opacity given to the visible water (0-255).
WATER_ALPHA = 150

# A water volume is an upright block: four corners round its flat top (x, z,
# in order round the edge, any start and direction) plus the heights of its
# bottom (y0) and of its surface (y1). The block can be turned about the
# vertical axis; it must be convex, which four corners of a rectangle are.
#
# As a mesh it has 8 corners: 0-3 go round the top, 4-7 sit straight below
# 0-3, and twelve triangles in the same order and winding as boxes in the
# game's own maps (each triangle's (b - a) x (c - a) points into the block).
BOX_TRIANGLES = ((2, 1, 0), (0, 3, 2), (5, 4, 0), (0, 1, 5), (6, 5, 1), (1, 2, 6),
                 (7, 6, 2), (2, 3, 7), (4, 7, 3), (3, 0, 4), (7, 4, 5), (5, 6, 7))


def box_volume(lo, hi):
    """The volume filling the axis-aligned box lo..hi."""
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    return ([(x0, z0), (x0, z1), (x1, z1), (x1, z0)], y0, y1)


def _turning(quad):
    """Positive when the top corners go one way round (seen from above), negative the other."""
    return sum(quad[i][0] * quad[(i + 1) % 4][1] - quad[(i + 1) % 4][0] * quad[i][1] for i in range(4))


def volume_corners(vol):
    """The volume's 8 mesh corners in BOX_TRIANGLES order."""
    quad, y0, y1 = vol
    # As in the game's boxes, the top must run the way that makes the top
    # triangles face down into the block; (x0,z0) (x0,z1) (x1,z1) (x1,z0) does.
    if _turning(quad) > 0:
        quad = quad[::-1]
    top = [(x, y1, z) for x, z in quad]
    return top + [(x, y0, z) for x, z in quad]


def volume_planes(vol):
    """Planes facing into the volume: a point is inside when nx*x + ny*y + nz*z + d >= 0 for every one."""
    quad, y0, y1 = vol
    cx = sum(p[0] for p in quad) / 4
    cz = sum(p[1] for p in quad) / 4
    out = []
    for i in range(4):
        (ax, az), (bx, bz) = quad[i], quad[(i + 1) % 4]
        nx, nz = bz - az, ax - bx
        length = math.hypot(nx, nz)
        nx, nz = nx / length, nz / length
        d = -(nx * ax + nz * az)
        if nx * cx + nz * cz + d < 0:
            nx, nz, d = -nx, -nz, -d
        out.append((nx, 0., nz, d))
    return out + [(0., 1., 0., -y0), (0., -1., 0., y1)]


def volume_box(vol):
    """Axis-aligned bounds (lo, hi) of a volume."""
    quad, y0, y1 = vol
    xs, zs = [p[0] for p in quad], [p[1] for p in quad]
    return (min(xs), y0, min(zs)), (max(xs), y1, max(zs))


def _pad(buf, n):
    buf += b'\0' * (-len(buf) % n)


def water_sections(volumes):
    """The three chunk sections that describe water volumes.

    1. A point-in-water test per volume: its planes, chained so that a point
       must be on the inner side of every plane.
    2. A small mesh per volume (centre and half size of its bounds, 8 corners,
       12 triangles).
    3. A collision tree per volume over that mesh, in the same format the
       exporter uses for map collision.
    The game takes the water surface from the top of each volume.
    """
    tests = bytearray(struct.pack('>I', len(volumes)))
    meshes = bytearray(struct.pack('>I', len(volumes)))
    trees = bytearray()
    for vol in volumes:
        planes = volume_planes(vol)
        _pad(tests, 4)
        tests += struct.pack('>4I', len(planes), len(planes), 0, 0)
        for p in planes:
            tests += struct.pack('>4f', *p)
        for i in range(len(planes)):
            # (plane, next if outside it, next if inside it); 0 = stop.
            tests += struct.pack('>3H', i, 0, i + 1 if i + 1 < len(planes) else 0)

        corners = volume_corners(vol)
        lo, hi = volume_box(vol)
        _pad(meshes, 4)
        meshes += struct.pack('>6f', *((lo[a] + hi[a]) / 2 for a in range(3)), *((hi[a] - lo[a]) / 2 for a in range(3)))
        meshes += struct.pack('>HHI', len(corners), 0, 0) + struct.pack('>HHI', len(BOX_TRIANGLES), 0, 0)
        _pad(meshes, 16)  # the section itself starts 64-aligned, so this is file alignment too
        for x, y, z in corners:
            meshes += struct.pack('>4f', x, y, z, 0.)
        for t in BOX_TRIANGLES:
            meshes += struct.pack('>3H', *t)

        tris = [[corners[k] for k in t] for t in BOX_TRIANGLES]
        block = rc.build_mopp_block([{'key': i, 'mn': [min(p[a] for p in t) for a in range(3)],
                                      'mx': [max(p[a] for p in t) for a in range(3)]} for i, t in enumerate(tris)])
        _pad(trees, 4)
        trees += struct.pack('>I', len(block)) + block
    return bytes(struct.pack('>I', len(tests)) + tests), bytes(meshes), bytes(trees)


def read_water(ch):
    """Bounds [(lo, hi), ...] of the water volumes in a parsed chunk, from its mesh section."""
    d = ch.get('list372').data
    n = rc.U32(d, 4)
    m = ch.get('rec40_380').data
    if rc.U32(m, 0) != n:
        raise RuntimeError('water sections disagree on the number of volumes')
    out, c = [], 4
    for _ in range(n):
        c = rc.Al(c, 4)
        cx, cy, cz, hx, hy, hz = struct.unpack_from('>6f', m, c)
        nv, nt = rc.U16(m, c + 24), rc.U16(m, c + 32)
        c = rc.Al(c + 40, 16) + 16 * nv + 6 * nt
        out.append(((cx - hx, cy - hy, cz - hz), (cx + hx, cy + hy, cz + hz)))
    return out


WATER_SECTIONS = ('list372', 'rec40_380', 'blobs384')


def write_water(chunk_bytes, volumes):
    """Chunk bytes with the given water volumes added; checks the result reads back the same."""
    ch = rc.read_chunk(chunk_bytes)
    if read_water(ch):
        raise RuntimeError('the map template already has water volumes')
    before = {s.name: bytes(s.data) for s in ch.secs}
    tests, meshes, trees = water_sections(volumes)
    ch.get('list372').data = bytearray(tests)
    ch.get('rec40_380').data = bytearray(meshes)
    ch.get('blobs384').data = bytearray(trees)
    out = rc.write_chunk(ch)
    check = rc.read_chunk(out)
    for s in check.secs:
        if s.name not in WATER_SECTIONS and bytes(s.data) != before[s.name]:
            raise RuntimeError('adding water changed another part of the map: ' + s.name)
    got = read_water(check)
    want = [volume_box(v) for v in volumes]
    if len(got) != len(want) or any(abs(a - b) > 1e-3 for (lo, hi), (glo, ghi) in zip(want, got)
                                    for a, b in zip(lo + hi, glo + ghi)):
        raise RuntimeError('water volumes did not read back the same')
    return bytes(out)


def water_faces(item, model):
    """Indices of the object's triangles that are water, or [] when it has none."""
    if not item.get('swimmable_water'):
        return []
    mats = item.get('water_materials')
    faces = model['faces']
    if not mats:
        return list(range(len(faces)))
    want = set(mats)
    return [i for i, f in enumerate(faces) if (f[3] or 'default') in want]


def see_through_copy(path, out_dir, alpha=WATER_ALPHA):
    """A copy of a texture with partial transparency, for the visible water surface."""
    from PIL import Image
    src = Path(path)
    data = src.read_bytes()
    out = Path(out_dir) / ('water_%s.png' % hashlib.sha256(data + bytes([alpha])).hexdigest()[:16])
    if not out.is_file():
        out.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(src) as im:
            im = im.convert('RGBA')
            im.putalpha(im.getchannel('A').point(lambda v: min(v, alpha)))
            im.save(out, 'PNG')
    return str(out)


def prepare_water(items, parse, tex_dir, log):
    """Sets up every water object for export and returns [(item index, face indices)].

    The water itself gets no collision (players fall into it and swim), a
    see-through copy of its texture and the water surface suffix. Whole-object
    water is drawn from both sides so it can be seen from under the surface.
    """
    found = []
    for i, it in enumerate(items):
        if not it.get('swimmable_water'):
            continue
        if it.get('native_prefab'):
            log(f'Water: "{it.get("name")}" is a breakable or movable object, so it cannot be water. Skipped.')
            continue
        model = parse(it['path'])
        faces = water_faces(it, model)
        if not faces:
            log(f'Water: "{it.get("name")}" has no water part. Skipped.')
            continue
        for m in {(model['faces'][f][3] or 'default') for f in faces}:
            tex = (it.get('textures') or {}).get(m)
            if tex and Path(tex).is_file():
                it.setdefault('textures', {})[m] = see_through_copy(tex, tex_dir)
                it.setdefault('alpha', {})[m] = True
            it.setdefault('surface_ids', {})[m] = WATER_SURFACE_ID
        if len(faces) == len(model['faces']):
            it['collision_disabled'] = True
            it['double_sided'] = True
        else:
            it['collision_excluded_faces'] = sorted(set(it.get('collision_excluded_faces') or []) | set(faces))
        found.append((i, faces))
    return found


def _upright(item):
    """True when the object is only turned about the vertical axis (no tilt)."""
    rx, _, rz = (float(v) for v in item.get('rotation', [0, 0, 0]))
    return all(abs(((a + 180) % 360) - 180) < 1e-6 for a in (rx, rz))


def water_volumes(items, found, parse, transform, convert):
    """[(name, volume)] for each water object in game coordinates, surface at its top.

    An upright object gets a block turned with it, covering the water part's own
    box; a tilted one gets the box around its water in world space. Either way
    the block reaches at least MIN_WATER_DEPTH below the surface.
    """
    out = []
    for i, faces in found:
        it = items[i]
        model = parse(it['path'])
        raw = [model['verts'][v] for v in sorted({v for f in faces for v in model['faces'][f][:3]})]
        if _upright(it):
            lo = [min(p[a] for p in raw) for a in range(3)]
            hi = [max(p[a] for p in raw) for a in range(3)]
            ring = ((lo[0], lo[2]), (lo[0], hi[2]), (hi[0], hi[2]), (hi[0], lo[2]))
            bottom = [convert(transform((x, lo[1], z), it)) for x, z in ring]
            top = [convert(transform((x, hi[1], z), it)) for x, z in ring]
            quad = [(p[0], p[2]) for p in top]
            ys = [p[1] for p in bottom + top]
            y0, y1 = min(ys), max(ys)
        else:
            pts = [convert(transform(p, it)) for p in raw]
            blo = [min(p[a] for p in pts) for a in range(3)]
            bhi = [max(p[a] for p in pts) for a in range(3)]
            quad, y0, y1 = box_volume(blo, bhi)
        out.append((it.get('name', 'Water'), (quad, min(y0, y1 - MIN_WATER_DEPTH), y1)))
    return out


def _sides(quad):
    return [math.dist(quad[i], quad[(i + 1) % 4]) for i in range(4)]


def add_water(chunk_path, volumes, log):
    """Writes the water volumes into the exported map chunk."""
    usable = []
    for name, vol in volumes:
        quad, y0, y1 = vol
        if not all(math.isfinite(v) for p in quad for v in p) or not math.isfinite(y0) or not math.isfinite(y1):
            log(f'Water: "{name}" has an invalid position. Skipped.')
        elif min(_sides(quad)) < MIN_WATER_SIDE:
            log(f'Water: "{name}" is too small (under {MIN_WATER_SIDE} m across). Skipped.')
        else:
            usable.append((name, vol))
    if len(usable) > MAX_WATER_VOLUMES:
        log(f'Water: only the first {MAX_WATER_VOLUMES} water objects are swimmable ({len(usable)} found).')
        usable = usable[:MAX_WATER_VOLUMES]
    if not usable:
        return 0
    path = Path(chunk_path)
    path.write_bytes(write_water(path.read_bytes(), [v for _, v in usable]))
    for name, (quad, y0, y1) in usable:
        s = _sides(quad)
        log(f'Water: "{name}" swimmable, surface at y {y1:.2f} m, {s[0]:.1f} x {s[1]:.1f} m.')
    return len(usable)


# ------------------------------------------------------ breakable profiles --

# Stock object profiles the game ships, by the exact name it looks up. Only
# profiles that need no extra effect files are offered. Health and weight are
# fixed per profile in the game's own table: a map cannot change them.
MOVABLE_PROFILES = {
    'Crate Small': 'Crate, 20 lb',
    "Wood Object 0.5'x0.5'x0.5'": 'Small wood block, 3 lb',
    "Wood Object 1'x1'x1'": 'Wood block, 10 lb',
    "Wood Object 2'x2'x2'": 'Big wood block, 35 lb',
    "Cardboard Box  0.5'x0.5'x0.5'1": 'Small cardboard box, 5 lb',
    "Cardboard Box  1'x1'x1'": 'Cardboard box, 15 lb',
    "Cardboard Box  4'x4'x4'": 'Big cardboard box, 200 lb',
    # Physics-prop behaviours (see physics_props.py for their shapes).
    'Tire': 'Rolls and bounces (tire), 10 lb',
    'Red Ball': 'Very bouncy ball that cannot break, 4 lb',
    'SoccerBall': 'Soccer ball, 5 lb',
    "Iron Object 1'x1'x1'": 'Metal block, 10 lb',
    'Trashcan': 'Trash can that cannot break, 50 lb',
    'CableSpool': 'Heavy cable spool, 500 lb',
    'Log Timber': 'Very heavy log that only cars and blasts move, 2000 lb',
}
BREAKING_PROFILES = {
    'Can': 'Breaks when shot (like a can), 7 lb',
    'SofaPillow': 'Breaks only from explosions, 4 lb',
    'Normal Glass Moveable': 'Fragile: breaks at the first hit, 1 lb',
}
DEFAULT_BREAKING = 'Can'


def prepare_breakables(items):
    """Routes "breakable wood" objects through the movable-prop path so they really break.

    The exporter's wood mode copies the glass record, so wood used to shatter
    like glass. A movable-prop record with a breaking profile (default: Can)
    instead makes it a loose object that disappears when destroyed.
    Returns {index in the native-object list: wanted profile name}.
    """
    wanted = {}
    j = 0
    for it in items:
        if not _is_native(it):
            continue
        behaviour = it.get('native_prop_behavior')
        profile = it.get('native_profile') or ''
        if it.get('native_prefab') == 'sr1_native_custom_mesh_glass_experiment' and it.get('native_breakable_kind') == 'wood' and not behaviour:
            it['native_prop_behavior'] = 'movable'
            wanted[j] = profile if profile in BREAKING_PROFILES else DEFAULT_BREAKING
        elif behaviour == 'movable' and (profile in MOVABLE_PROFILES or profile in BREAKING_PROFILES) and profile != 'Crate Small':
            wanted[j] = profile
        j += 1
    return wanted


def _is_native(it):
    return it.get('native_prefab') in ('sr1_native_glass_3x3', 'sr1_native_custom_mesh_glass_experiment')


def set_profiles(chunk_path, wanted_by_source, log):
    """Points each native object's record at the named stock profile."""
    if not wanted_by_source:
        return 0
    path = Path(chunk_path)
    original = path.read_bytes()
    ch = rc.read_chunk(original)
    recs = ch.get('static_records').data
    db = ch.get('rec_blob308').data
    count = rc.U32(ch.header, 868)
    known = {}
    c = 4
    while c < len(db):
        z = db.index(0, c)
        known.setdefault(bytes(db[c:z]).decode('ascii', 'replace'), c - 4)
        c = z + 1
    for source, name in wanted_by_source.items():
        if not 0 <= source < count:
            raise RuntimeError('native object record out of range')
        if name not in known:
            known[name] = len(db) - 4
            db += name.encode('ascii') + b'\0'
        rc.Wr32(recs, source * 80 + 64, known[name])
    rc.Wr32(db, 0, len(db) - 4)
    out = rc.write_chunk(ch)
    check = rc.read_chunk(out)
    first = rc.read_chunk(original)
    for s in check.secs:
        if s.name not in ('static_records', 'rec_blob308') and bytes(s.data) != bytes(first.get(s.name).data):
            raise RuntimeError('setting object profiles changed another part of the map: ' + s.name)
    r, b = check.get('static_records').data, check.get('rec_blob308').data
    for source, name in wanted_by_source.items():
        start = 4 + rc.U32(r, source * 80 + 64)
        if bytes(b[start:b.index(0, start)]).decode('ascii') != name:
            raise RuntimeError('object profile did not read back')
    path.write_bytes(bytes(out))
    log(f'Breakables: {len(wanted_by_source)} object(s) given stock profiles: ' + ', '.join(sorted(set(wanted_by_source.values()))))
    return len(wanted_by_source)


# ------------------------------------------------------- loading screen --

LOADING_W, LOADING_H = 1280, 720
# The game builds the file name "ld-<map>" in a 17-byte buffer.
LOADING_NAME_MAX = 16


def loading_name(map_name):
    """File stem the game looks for: "ld-" plus as much of the map name as fits."""
    return ('ld-' + map_name)[:LOADING_NAME_MAX]


def fit_image(path, out_path):
    """Crops the picture to 16:9 around its middle and resizes it to 1280x720."""
    from PIL import Image
    with Image.open(path) as im:
        im = im.convert('RGB')
        w, h = im.size
        want = LOADING_W / LOADING_H
        if w / h > want:
            nw = max(1, round(h * want)); box = ((w - nw) // 2, 0, (w - nw) // 2 + nw, h)
        else:
            nh = max(1, round(w / want)); box = (0, (h - nh) // 2, w, (h - nh) // 2 + nh)
        im = im.crop(box).resize((LOADING_W, LOADING_H), Image.LANCZOS)
        im.save(out_path, 'PNG')
    return out_path


def loading_peg(png_path, map_name):
    """A one-picture .peg_xbox2 holding the 1280x720 loading screen (DXT1, Xbox 360 tiled)."""
    enc = peg.encode_texture(png_path, use_alpha=False)
    if (enc['width'], enc['height'], enc['fmt']) != (LOADING_W, LOADING_H, peg.FMT_DXT1):
        raise RuntimeError('loading screen must be a 1280x720 DXT1 picture')
    payload = enc['payload']
    data_at = 0x1000
    head = bytearray(data_at)
    dir_size = peg.HEADER_SIZE + peg.ENTRY_SIZE
    # Header: magic, version 8, platform 3, directory size, picture data size,
    # 1 entry, no flags, 1 entry in total, 16-byte alignment.
    struct.pack_into('>IHHIIHHHH', head, 0, peg.MAGIC, 8, 3, dir_size, len(payload), 1, 0, 1, 16)
    e = peg.HEADER_SIZE
    struct.pack_into('>IHHH', head, e, data_at, LOADING_W, LOADING_H, peg.FMT_DXT1)
    struct.pack_into('>H', head, e + 0x0C, 1)
    head[e + 0x14], head[e + 0x15], head[e + 0x16] = 0, 1, 1
    name = (loading_name(map_name) + '.tga').encode('ascii')
    if len(name) >= peg.NAME_LEN:
        raise RuntimeError('loading screen name too long')
    head[e + peg.NAME_OFF:e + peg.NAME_OFF + len(name)] = name
    struct.pack_into('>I', head, e + 0x34, len(payload))
    return bytes(head) + payload


def write_loading_screen(out_dir, map_name, image_path, work_dir, log):
    stem = loading_name(map_name)
    if len('ld-' + map_name) > LOADING_NAME_MAX:
        log(f'Loading screen: the game only reads {LOADING_NAME_MAX - 3} characters of the map name, so it is saved as {stem}.peg_xbox2.')
    png = fit_image(image_path, Path(work_dir) / 'loading_1280x720.png')
    data = loading_peg(png, map_name)
    (Path(out_dir) / (stem + '.peg_xbox2')).write_bytes(data)
    log(f'Loading screen: {stem}.peg_xbox2 (1280 x 720).')
    return stem


# ------------------------------------------------------ background sound --

# Sound files of the game's own multiplayer maps (only their file names; the
# sounds stay in the player's game). Including one plays that map's ambience.
AMBIENCE_FILES = ('amb_mp_arena', 'amb_mp_bac_01', 'amb_mp_bac_03', 'amb_mp_bor_01', 'amb_mp_bor_02',
                  'amb_mp_bor_03', 'amb_mp_coop_delivery', 'amb_mp_coop_gauntlet', 'amb_mp_ptp_01',
                  'amb_mp_ptp_02', 'amb_mp_ptp_03', 'amb_mplobby_01')


def add_include(cts_text, include):
    """Adds `$Include: "<include>.cts"` to the CTS's #Includes block (made if missing)."""
    line = f'$Include: "{include}.cts"'
    if re.search(r'^\s*\$Include:\s*"' + re.escape(include) + r'\.cts"', cts_text, re.M | re.I):
        return cts_text
    nl = '\r\n' if '\r\n' in cts_text else '\n'
    lines = cts_text.split(nl)
    for i, l in enumerate(lines):
        if l.strip().lower() == '#includes':
            at = i + 1
            # Skip the "// -------" rule under the heading, if there is one.
            if at < len(lines) and lines[at].strip().startswith('//'):
                at += 1
            lines.insert(at, line)
            return nl.join(lines)
    return nl.join(['// -------', '#Includes', '// -------', line, ''] + lines)


def add_ambience(out_dir, base, include, log):
    if include not in AMBIENCE_FILES:
        raise ValueError('Unknown background sound: ' + str(include))
    done = []
    for name in (base + '.cts', base + '_ptp.cts'):
        p = Path(out_dir) / name
        if p.is_file():
            # Bytes in and out, so the file keeps its own line endings.
            text = p.read_bytes().decode('utf-8-sig')
            p.write_bytes(add_include(text, include).encode('utf-8'))
            done.append(name)
    if done:
        log(f'Background sound: {include}.cts included by ' + ', '.join(done) + ' (from your game, not shipped).')
    return done
