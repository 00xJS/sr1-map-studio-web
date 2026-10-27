"""Exported records and materials set the way the game's own maps set them.

The exporter clones everything it writes from the Beaver Creek template, and
the template's values are not what retail maps use for ordinary geometry.
This module (installed over the upstream functions; studio-py/ is not
edited) changes them on purpose:

- Materials: the template's plain bb-simple1 materials carry
  Self_Illumination 0.12, which lifts every surface toward full brightness
  whatever the light (about +64 % at a typical ambient), and its first
  alpha-capable material is a glow-class one (flags 0xB, 0.35). Retail
  bb-simple1 materials, alpha cut-outs included, are flags 3 with
  Self_Illumination 0. So new materials are cloned from a plain (flags 3)
  template material, alpha ones too, and every bb-simple1 material in the
  map ends with Self_Illumination 0 (glass and props included).
- Fade distances: each record keeps its donor's fade distance (+28, the
  distance squared): 20 m for glass panes, 75 m for props. They are set on
  purpose instead: world geometry 5000 m (the far clip: never fades),
  props, breakables and glass 150 m.
- Lights: each light's own full-bright and outer ranges are written (in
  metres: editor units x world scale), as before; new lights start at the
  retail interior ranges (1 / 3 m, street lamps 11 / 17 m, see
  src/lib/project.ts LIGHT_RANGES) instead of 0.5 / 4 m, and each light's
  fade distance (+112) follows its range like retail's (20 m for a 3 m
  light, up to the engine's 75 m cap for lamps) instead of 20 m for all.
- Decals: look-only overlays (an item without collision that is a tag or
  sticker stuck on a wall, or any other flat sheet without collision, such
  as road markings) get their own record on decal layer 1 (flags | 0x402,
  as retail's floating decals: the game biases them toward the camera and
  leaves them out of the depth pre-pass, so they no longer z-fight with the
  surface under them), their instance left out of collision (0x1, retail
  0x1001), and a 150 m fade. When one of their meshes also holds other
  look-only geometry, the decal batches move to a mesh, vertex buffer and
  record of their own (from the template's free slots).
- Height map: the u32 after the .hmap_xbox2 origin and size is 4 in every
  retail map; upstream writes 0. It is written as 4.

tests/retail_records_check.py checks all of it.
"""
from __future__ import annotations

import contextlib
import copy
import struct
from pathlib import Path

import sr1_lighting
import sr_reborn_bridge as bridge
import sr_reborn_core as rc

K_BASE_SHADER = bridge.K_BASE_SHADER
# Volition hash (CRC-32 of the lower-cased name, no inversion) of the shader constant.
SELF_ILLUMINATION = 0x9F9A4F60
PLAIN = 3          # material flags of ordinary retail geometry
GLOW = 0x8         # the self-illuminated class (lit windows, lamps, neon)
CONSTANTS = 4      # material part holding the 24-byte constants (name hash, register, 0, 4 floats)

# Record fields (80-byte static records).
FADE = 28                # fade distance squared
FLAGS = 32
INSTANCE = 60
RENDERS = 0x10000000     # an ordinary drawn static record
NATIVE = 0x20000         # a movable / breakable object (has a collision shape and a profile)
GLASS = 0x1400           # with NATIVE: a glass pane (0x10021400)
SKY = 0x8000             # drawn through the sky list only
FADE_WORLD = 5000.0      # metres; the game's far clip, so world geometry never fades
FADE_PROP = 150.0
FADE_GLASS = 150.0
FADE_DECAL = 150.0       # retail decals fade at 30-1000 m (75 m for floaters)
DECAL_LAYER = 0x402      # record flags: decal layer 1 ((flags >> 1) & 3) and 0x400, as retail's 0x10000402
NO_INSTANCE_COLLISION = 0x1   # instance +108 bit (part of 0x4c7): left out of the instance collision
DECAL_THICKNESS = 0.13   # editor units: a look-only item this thin (or thinner) is an overlay
# Lights: retail interior omni lights (metres; the editor's units are these / world scale).
LIGHT_INNER, LIGHT_RANGE = 1.0, 3.0
LIGHT_FADE_MIN, LIGHT_FADE_MAX = 20.0, 75.0   # retail +112 values; 75 m is level_lights_fade_dist_cap

# .hmap_xbox2: origin x, z (s32), width, height (u32), then this u32 (4 in every retail height map), then u16 heights.
HMAP_FIELD = 16
HMAP_RETAIL = 4

_original = {}


def volition_hash(name):
    h = 0
    for ch in name.lower().encode():
        h ^= ch
        for _ in range(8):
            h = (h >> 1) ^ (0xEDB88320 if h & 1 else 0)
    return h


def plain_template(g, index):
    """`index`, or when that material glows, the first plain material with the same shader."""
    M = g.mats[index]
    if not rc.U16(M.m, 0x12) & GLOW:
        return index
    shader = rc.U32(M.m, 0)
    for i, other in enumerate(g.mats):
        if rc.U32(other.m, 0) == shader and rc.U16(other.m, 0x12) == PLAIN:
            return i
    raise RuntimeError('The template has no plain material to clone alpha materials from.')


def self_illumination(M):
    part = M.parts[CONSTANTS]
    for k in range(len(part) // 24):
        if rc.U32(part, 24 * k) == SELF_ILLUMINATION:
            return struct.unpack_from('>f', part, 24 * k + 8)[0]
    return None


def set_self_illumination(M, value):
    part = M.parts[CONSTANTS]
    for k in range(len(part) // 24):
        if rc.U32(part, 24 * k) == SELF_ILLUMINATION:
            struct.pack_into('>f', part, 24 * k + 8, float(value))
            return True
    return False


@contextlib.contextmanager
def _plain_clones():
    """While a build runs: clone new materials (and their resource links) from plain template materials, unlit."""
    clone, links = bridge._clone_material, bridge._clone_material_resource_links

    def clone_material(g, base_idx, name_hash, string_idx):
        M = clone(g, plain_template(g, base_idx), name_hash, string_idx)
        if rc.U32(M.m, 0) == K_BASE_SHADER:
            set_self_illumination(M, 0.0)
        return M

    def clone_links(g, base_idx, key):
        return links(g, plain_template(g, base_idx), key)
    bridge._clone_material, bridge._clone_material_resource_links = clone_material, clone_links
    try:
        yield
    finally:
        bridge._clone_material, bridge._clone_material_resource_links = clone, links


def build_bbchunk_multibatch(*a, **kw):
    with _plain_clones():
        return _original['build'](*a, **kw)


def unlit_materials(g):
    """Self_Illumination 0 on every bb-simple1 material in the map (run before the game's own sky is added).

    Catches the materials cloned outside the main build: breakable wood and
    native props copy a template or prefab material as it is, and the tinted
    glass prefab material is glow-class with Self_Illumination 1 (drawn at
    twice its colour whatever the light). Nothing the editor makes is meant
    to glow. The glass keeps its flags (27): the meaning of its 0x10 bit is
    not known, and the pane needs its see-through path.
    """
    changed = 0
    for M in g.mats:
        if rc.U32(M.m, 0) == K_BASE_SHADER and (self_illumination(M) or 0.0) != 0.0:
            set_self_illumination(M, 0.0)
            changed += 1
    return changed


def record_kind(flags):
    """'world', 'prop', 'glass', 'decal' or None (the sky, or a record that is not drawn)."""
    if flags & SKY or not flags & RENDERS:
        return None
    if (flags >> 1) & 3:
        return 'decal'
    if flags & NATIVE:
        return 'glass' if flags & GLASS == GLASS else 'prop'
    return 'world'


def set_fades(ch):
    """Fade distances by kind of record; returns {kind: count}."""
    recs = ch.get('static_records').data
    want = {'world': FADE_WORLD, 'prop': FADE_PROP, 'glass': FADE_GLASS, 'decal': FADE_DECAL}
    counts = {}
    for r in range(rc.U32(ch.header, 868)):
        kind = record_kind(rc.U32(recs, 80 * r + FLAGS))
        if kind is None:
            continue
        rc.WrF(recs, 80 * r + FADE, want[kind] ** 2)
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def is_decal(item, dims):
    """A look-only overlay: no collision, not glass, a prop or water, and a tag/sticker or a flat sheet.

    `dims` is the item's size in editor units. Tags and stickers stuck on a
    wall are made by src/lib/photoPiece.ts decalParts (group "Decal@...");
    any other item without collision this thin lies on or against a surface.
    """
    if not item.get('collision_disabled') or item.get('swimmable_water') or item.get('native_prefab') or item.get('native_prop_behavior'):
        return False
    return str(item.get('group') or '').startswith('Decal@') or (bool(dims) and min(dims) <= DECAL_THICKNESS)


def _strip_triangles(idx):
    return sum(1 for i in range(2, len(idx)) if len({idx[i - 2], idx[i - 1], idx[i]}) == 3)


def layer_decals(ch, g, decal_materials):
    """Decal batches onto decal-layer records of their own. Returns {'records': n, 'split': n, 'left': n}."""
    import native_sky   # the template's free slots, found the way the glass transplant and the sky find them
    out = {'records': 0, 'split': 0, 'left': 0}
    decal_materials = set(decal_materials)
    if not decal_materials:
        return out
    recs, inst = ch.get('static_records').data, ch.get('instances').data
    n_inst = len(inst) // 112
    users = {}
    for r in range(rc.U32(ch.header, 868)):
        ii = rc.I32(recs, 80 * r + INSTANCE)
        if 0 <= ii < n_inst and record_kind(rc.U32(recs, 80 * r + FLAGS)) == 'world':
            users.setdefault(rc.U32(inst, 112 * ii + 104), []).append((r, ii))
    free_records, free_meshes, free_vbs = native_sky._free_slots(ch, g)
    blocks = rc.parse_mopp_blocks(g.coll)
    a164 = ch.get('a164').data

    def layer(r, ii, mesh):
        rc.Wr32(recs, 80 * r + FLAGS, rc.U32(recs, 80 * r + FLAGS) | DECAL_LAYER)
        rc.Wr32(inst, 112 * ii + 108, rc.U32(inst, 112 * ii + 108) | NO_INSTANCE_COLLISION)
        h = g.meshes[mesh].hdr
        lo, hi = rc.instance_aabb(inst, ii, [rc.F32(h, 4 * a) for a in range(3)], [rc.F32(h, 12 + 4 * a) for a in range(3)])
        for a in range(3):
            rc.WrF(recs, 80 * r + 4 * a, lo[a])
            rc.WrF(recs, 80 * r + 16 + 4 * a, hi[a])
        out['records'] += 1

    for k in sorted(users):
        M = g.meshes[k] if k < len(g.meshes) else None
        if M is None or len(M.subs) != 1 or len(users[k]) != 1 or blocks[k]['code']:
            continue   # shared, collision or unexpected meshes are left as they are
        S = M.subs[0]
        batches = [(rc.U32(S.b16, 8 * b), rc.U16(S.b16, 8 * b + 4), rc.U16(S.b16, 8 * b + 6)) for b in range(rc.U16(S.s16, 2))]
        dec = [b for b in batches if b[2] in decal_materials]
        if not dec:
            continue
        r, ii = users[k][0]
        if len(dec) == len(batches):
            layer(r, ii, k)
            continue
        if not free_records or not free_meshes or not free_vbs:
            out['left'] += 1
            continue
        (r2, ii2), k2, v2 = free_records.pop(0), free_meshes.pop(0), free_vbs.pop(0)
        # The decal batches' strips and vertices, in a buffer of their own.
        V = g.vbs[rc.U32(S.s16, 8)]
        stride = rc.U16(V.desc, 16)
        idx = [rc.U16(V.ib, 2 * i) for i in range(len(V.ib) // 2)]
        used = sorted({idx[i] for f, c, _ in dec for i in range(f, f + c)})
        remap = {o: j for j, o in enumerate(used)}
        ib, moved, tris = bytearray(), [], 0
        for f, c, mat in dec:
            moved.append((len(ib) // 2, c, mat))
            strip = [remap[idx[i]] for i in range(f, f + c)]
            tris += _strip_triangles(strip)
            for x in strip:
                rc.Put16(ib, x)
        NV = copy.deepcopy(V)
        NV.vd = bytearray(b''.join(bytes(V.vd[o * stride:(o + 1) * stride]) for o in used))
        NV.ib = ib
        rc.Wr16(NV.desc, 0, min(tris, 0xFFFF))
        rc.Wr16(NV.desc, 12, len(used))
        rc.Wr16(NV.desc, 14, len(ib) // 2)
        g.vbs[v2] = NV
        g.auxflag[v2] = g.auxflag[rc.U32(S.s16, 8)]
        NM = copy.deepcopy(M)
        sub = NM.subs[0]
        rc.Wr16(sub.s16, 2, len(moved))
        rc.Wr32(sub.s16, 8, v2)
        sub.b16 = bytearray()
        for f, c, mat in moved:
            rc.Put32(sub.b16, f)
            rc.Put16(sub.b16, c)
            rc.Put16(sub.b16, mat)
        pts = [[rc.F32(NV.vd, stride * j + 4 * a) for a in range(3)] for j in range(len(used))]
        for a in range(3):
            rc.WrF(NM.hdr, 4 * a, min(p[a] for p in pts))
            rc.WrF(NM.hdr, 12 + 4 * a, max(p[a] for p in pts))
        g.meshes[k2] = NM
        a164[16 * k2:16 * k2 + 16] = a164[16 * k:16 * k + 16]
        # The old mesh keeps the rest.
        keep = [b for b in batches if b[2] not in decal_materials]
        rc.Wr16(S.s16, 2, len(keep))
        S.b16 = bytearray()
        for f, c, mat in keep:
            rc.Put32(S.b16, f)
            rc.Put16(S.b16, c)
            rc.Put16(S.b16, mat)
        # The new mesh's object: the old one's instance (placement, flags) and record settings.
        inst[112 * ii2:112 * ii2 + 112] = inst[112 * ii:112 * ii + 112]
        rc.Wr32(inst, 112 * ii2 + 104, k2)
        rc.Wr32(recs, 80 * r2 + FLAGS, rc.U32(recs, 80 * r + FLAGS))
        layer(r2, ii2, k2)
        out['split'] += 1
    return out


def finish_map(chunk_path, log=None, decal_materials=()):
    """The retail values above, on the map chunk export_map wrote (before water, physics shapes and the sky).

    decal_materials: the material indices of look-only overlay items (see is_decal).
    """
    path = Path(chunk_path)
    ch = rc.read_chunk(path.read_bytes())
    g = rc.chunk_geometry(ch)
    unlit = unlit_materials(g)
    decals = layer_decals(ch, g, decal_materials)
    rc.set_geometry(ch, g)
    fades = set_fades(ch)
    path.write_bytes(rc.write_chunk(ch))
    if log:
        log(f'Materials: Self_Illumination 0, as retail ({unlit} copied value(s) cleared).')
        log('Fade distances: ' + ', '.join(f'{n} {k} record(s) {dict(world=FADE_WORLD, prop=FADE_PROP, glass=FADE_GLASS, decal=FADE_DECAL)[k]:g} m'
                                          for k, n in sorted(fades.items())) + '.')
        if decal_materials:
            log(f'Decals: {decals["records"]} look-only overlay record(s) on decal layer 1, no collision'
                + (f' ({decals["split"]} moved to a mesh of their own)' if decals['split'] else '')
                + (f'; {decals["left"]} left on the base layer: no free template slot' if decals['left'] else '') + '.')
    return {'unlit': unlit, 'fades': fades, 'decals': decals}


GLOW_CLASS = 0xB   # flags of retail's glowing materials (a lamp's lit glass: 0xB, Self_Illumination 0.8)


def set_glow(chunk_path, glow, log=None):
    """Materials drawn blended and lit by themselves, as the map they were opened from had them (after finish_map).

    glow: material index -> Self_Illumination (0-1). Each becomes glow-class (flags 0xB, laid out as the plain
    bb-simple1 materials it was cloned from) with that Self_Illumination; 0 keeps it blended but unlit.
    """
    if not glow:
        return 0
    path = Path(chunk_path)
    ch = rc.read_chunk(path.read_bytes())
    g = rc.chunk_geometry(ch)
    done = 0
    for index, value in sorted(glow.items()):
        M = g.mats[index]
        if rc.U32(M.m, 0) != K_BASE_SHADER:
            continue
        rc.Wr16(M.m, 0x12, GLOW_CLASS)
        set_self_illumination(M, max(0.0, min(1.0, float(value))))
        done += 1
    rc.set_geometry(ch, g)
    path.write_bytes(rc.write_chunk(ch))
    if log:
        log(f'Glow: {done} material(s) drawn blended and lit by themselves, as in the map they came from.')
    return done


def fix_hmap(path, log=None):
    """The retail value in the height map's header field (upstream leaves it 0)."""
    path = Path(path)
    d = bytearray(path.read_bytes())
    if len(d) < 20:
        raise ValueError('Height map too short: ' + path.name)
    struct.pack_into('>I', d, HMAP_FIELD, HMAP_RETAIL)
    path.write_bytes(bytes(d))
    if log:
        log(f'Height map: header field +{HMAP_FIELD} = {HMAP_RETAIL}, as in every retail map.')


def new_light(position=(0, 3, 0), world_scale=0.5):
    """sr1_lighting.new_light with the retail interior ranges (in editor units)."""
    light = _original['new_light'](position)
    light.update(inner_range=LIGHT_INNER / world_scale, range=LIGHT_RANGE / world_scale)
    return light


def light_fade(outer_m):
    """+112 for a light reaching `outer_m` metres: retail rooms (3 m) 20 m, lamps (17 m) 60-75 m."""
    return max(LIGHT_FADE_MIN, min(LIGHT_FADE_MAX, 4.0 * float(outer_m)))


def light_record(light, position, scale):
    """sr1_lighting._record (ranges from the light itself, x world scale), with a fade distance to match its range."""
    b = _original['light_record'](light, position, scale)
    rc.WrF(b, 112, light_fade(light['range'] * scale))
    return b


def install():
    if _original:
        return
    _original.update(build=bridge.build_bbchunk_multibatch, new_light=sr1_lighting.new_light, light_record=sr1_lighting._record)
    bridge.build_bbchunk_multibatch = build_bbchunk_multibatch
    sr1_lighting.new_light = new_light
    sr1_lighting._record = light_record


def uninstall():
    if _original:
        bridge.build_bbchunk_multibatch = _original['build']
        sr1_lighting.new_light = _original['new_light']
        sr1_lighting._record = _original['light_record']
        _original.clear()
