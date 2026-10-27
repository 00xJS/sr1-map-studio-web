"""The minimap region of a map chunk: which picture the HUD and the pause map show, and over what area.

Maps made from the Beaver Creek template (this editor, the desktop SR1 Map
Studio and the converters built on it) carry the template's one region with
one floor, naming beavercreek.tga over Beaver Creek's own rectangle, with its
pause-map flag off. The block, as the game reads it:

  u32 outer_count; outer entries of 36 bytes (centre, half extents, +28 floor
  count, +32 first floor); u32 floor_total; floors of 36 bytes (centre, full
  size, +24 floor number, +28 flags, bit 0 = also the pause map, +32 name
  offset); u32 string_bytes; the floor names.

point() patches it in place (same sizes, so nothing after it moves): the floor
covers the given game-frame box, the pause-map flag is set, and it names the
map's own minimap picture. switch_on() then makes sure the camera is always in
one of the map's regions, without which the game never uses the floor and the
minimap stays black (found in game on Dust, 2026-10-24). Used by the export
(web_api.py) and by the quick upgrade for finished maps (map_upgrade.py).
"""
import struct

DONOR = 'beavercreek.tga'
SECTION = 'rec36_432'  # the chunk part (sr_reborn_core) the block is in
NAME_BYTES = 16  # the template's name block: 15 letters and the closing zero
FLOOR, OUTER = 36, 36


def find(d, name=DONOR):
    """Offset of `name` in a one-floor region block like the template's (not in the header or the string table), or -1."""
    raw = name.encode('ascii') + b'\x00'
    at = d.find(raw)
    while at >= 0:
        inner = at - 4 - FLOOR
        outer = inner - 4 - OUTER
        if outer >= 4 and struct.unpack_from('>I', d, at - 4)[0] == NAME_BYTES and struct.unpack_from('>I', d, inner - 4)[0] == 1 \
                and struct.unpack_from('>I', d, outer - 4)[0] == 1:
            return at
        at = d.find(raw, at + 1)
    return -1


def point(d, at, x0, x1, z0, z1, name):
    """Points the region found at `at` (find()) at `name` over x0..x1, z0..z1 (game metres), in place."""
    raw = name.encode('ascii')
    if len(raw) >= NAME_BYTES:
        raise ValueError(f'minimap name {name!r} is longer than the region has room for ({NAME_BYTES - 1} letters)')
    inner, outer = at - 4 - FLOOR, at - 4 - FLOOR - 4 - OUTER
    # Height: the map's own bounds (header +0x3AC), with room above and below.
    y0, y1 = struct.unpack_from('>f', d, 0x3AC + 4)[0] - 50.0, struct.unpack_from('>f', d, 0x3AC + 16)[0] + 100.0
    c = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    size = (x1 - x0, y1 - y0, z1 - z0)
    struct.pack_into('>6f', d, outer, *c, *(v / 2 + 50.0 for v in size))
    struct.pack_into('>6f', d, inner, *c, *size)
    d[inner + 28] = 1
    d[at:at + NAME_BYTES] = raw + b'\x00' * (NAME_BYTES - len(raw))


REGION_MARGIN = 50.0  # metres the map region reaches past the minimap's area: the game tests the camera


def switch_on(d, name):
    """Chunk bytes in which the game uses the minimap floor named `name`: the floor is only used while the camera is
    inside one of the map's regions (regions.py, tried in game on Dust), so one over the whole map is added when no
    region covers the floor. Returns (bytes, whether one was added)."""
    import regions
    d = bytes(d)
    at = find(d, name)
    if at < 0:
        raise ValueError('no minimap floor named ' + name)
    (cx, cy, cz), (sx, sy, sz), _ = floor(d, at)
    x0, x1, z0, z1 = cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2
    if regions.covered(d, x0, x1, z0, z1, cy - sy / 2, cy + sy / 2):
        return d, False
    m = REGION_MARGIN
    out = regions.with_map_region(d, x0 - m, x1 + m, z0 - m, z1 + m, cy - sy / 2, cy + sy / 2)
    if find(out, name) < 0:
        raise RuntimeError('the minimap floor was lost adding the map region')
    return out, True


def floor(d, at):
    """(centre, size, pause-map flag) of the floor whose name is at `at` (for checks)."""
    inner = at - 4 - FLOOR
    v = struct.unpack_from('>6f', d, inner)
    return v[:3], v[3:], d[inner + 28] & 1
