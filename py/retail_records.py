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

tests/retail_records_check.py checks all of it.
"""
from __future__ import annotations

import contextlib
import struct
from pathlib import Path

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
    """'world', 'prop', 'glass' or None (the sky, or a record that is not drawn)."""
    if flags & SKY or not flags & RENDERS:
        return None
    if flags & NATIVE:
        return 'glass' if flags & GLASS == GLASS else 'prop'
    return 'world'


def set_fades(ch):
    """Fade distances by kind of record; returns {kind: count}."""
    recs = ch.get('static_records').data
    want = {'world': FADE_WORLD, 'prop': FADE_PROP, 'glass': FADE_GLASS}
    counts = {}
    for r in range(rc.U32(ch.header, 868)):
        kind = record_kind(rc.U32(recs, 80 * r + FLAGS))
        if kind is None:
            continue
        rc.WrF(recs, 80 * r + FADE, want[kind] ** 2)
        counts[kind] = counts.get(kind, 0) + 1
    return counts


def finish_map(chunk_path, log=None):
    """The retail values above, on the map chunk export_map wrote (before water, physics shapes and the sky)."""
    path = Path(chunk_path)
    ch = rc.read_chunk(path.read_bytes())
    g = rc.chunk_geometry(ch)
    unlit = unlit_materials(g)
    if unlit:
        rc.set_geometry(ch, g)
    fades = set_fades(ch)
    path.write_bytes(rc.write_chunk(ch))
    if log:
        log(f'Materials: Self_Illumination 0, as retail ({unlit} copied value(s) cleared).')
        log('Fade distances: ' + ', '.join(f'{n} {k} record(s) {dict(world=FADE_WORLD, prop=FADE_PROP, glass=FADE_GLASS)[k]:g} m'
                                          for k, n in sorted(fades.items())) + '.')
    return {'unlit': unlit, 'fades': fades}


def install():
    if _original:
        return
    _original.update(build=bridge.build_bbchunk_multibatch)
    bridge.build_bbchunk_multibatch = build_bbchunk_multibatch


def uninstall():
    if _original:
        bridge.build_bbchunk_multibatch = _original['build']
        _original.clear()
