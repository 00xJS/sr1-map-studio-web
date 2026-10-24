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
map's own minimap picture. Used by the export (web_api.py) and by the quick
upgrade for finished maps (map_upgrade.py).
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


def floor(d, at):
    """(centre, size, pause-map flag) of the floor whose name is at `at` (for checks)."""
    inner = at - 4 - FLOOR
    v = struct.unpack_from('>6f', d, inner)
    return v[:3], v[3:], d[inner + 28] & 1
