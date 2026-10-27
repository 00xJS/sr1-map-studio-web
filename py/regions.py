"""Rain blockers and indoor rooms: the map chunk's region list.

The game keeps a list of boxes in each map chunk and tests the camera against
them every frame; the first box the camera is inside sets how the world looks
there. A box marked indoor fades the rain out (and the weather's fog and some
sounds); a room can also have its own flat ambient light, no sky and no sun
shadows, as the game's own interiors do. Custom maps have none, so it rains
inside every building.

Two marker types make them:
  Rain blocker  - no rain inside; lighting and sky as outside.
  Indoor room   - no rain, a room's even ambient light, no sky, no sun shadows.
The export (and a quick upgrade for finished maps) also finds the floor under
roofs and ceilings itself and puts rain blockers over it: interiors.py.

A marker's box stands on it (its bottom at the marker), is sized in metres
(width, height, depth) and turns with the marker. Because the test is the
camera, not the player, the box should reach a few metres past the walls and
above head height (the editor starts boxes generously). Rain only falls on
maps whose weather changes each match; with "always clear" there is none to
block, but rooms still change the light.

Each region is an 88-byte record (box, flags, colours, fog, blend time), then
for each region the planes of its block in the same layout as the water
volumes' (a plane list and a tiny tree over it). Nothing here has been tried
in game yet.
"""
import math
import struct
from pathlib import Path

import sr_reborn_core as rc
import interiors
from map_features import volume_box, volume_planes

RAIN_BLOCKER = 'Rain blocker'
INDOOR_ROOM = 'Indoor room'
TYPES = (RAIN_BLOCKER, INDOOR_ROOM)

SECTION = 'rec88_484'
# Region flags: 0x1 own ambient, 0x2 own character ambient, 0x8 indoors (no rain),
# 0x10 no sky, 0x20 no sun shadows. 0x4 hides the map's outdoor objects while
# the camera is inside, so it is never set here.
FLAG_AMBIENT, FLAG_CHAR_AMBIENT, FLAG_INDOOR, FLAG_NO_SKY, FLAG_NO_SUN_SHADOWS = 0x1, 0x2, 0x8, 0x10, 0x20
FLAGS = {RAIN_BLOCKER: FLAG_INDOOR,
         INDOOR_ROOM: FLAG_AMBIENT | FLAG_CHAR_AMBIENT | FLAG_INDOOR | FLAG_NO_SKY | FLAG_NO_SUN_SHADOWS}
DEFAULT_SIZE = {RAIN_BLOCKER: (20.0, 10.0, 20.0), INDOOR_ROOM: (16.0, 8.0, 16.0)}
DEFAULT_AMBIENT = 0.35
# How long the look takes to change when the camera crosses the edge (seconds; never 0).
BLEND = 1.0
MAX_REGIONS = 64
MIN_SIDE = 1.0


def _size(m):
    default = DEFAULT_SIZE.get(m.get('type'), (16.0, 8.0, 16.0))
    size = m.get('size') or default
    out = []
    for v, d in zip(size, default):
        try:
            v = float(v)
        except (TypeError, ValueError):
            v = d
        out.append(v if math.isfinite(v) and v > 0 else d)
    return out


def region_volumes(markers, world_scale, convert):
    """[(marker, volume)] in game coordinates for every rain blocker and indoor room.

    `convert` maps an editor-space point to game space (as the markers are
    converted). The box's corners are worked out in editor space, turned like
    the editor draws the box, then converted one by one, so a mirrored map
    keeps its boxes where they are drawn.
    """
    out = []
    for m in markers:
        if m.get('type') not in TYPES:
            continue
        px, py, pz = (float(v) for v in m.get('position', (0, 0, 0)))
        w, h, d = (v / world_scale for v in _size(m))
        yaw = math.radians(float(m.get('yaw', 0) or 0))
        c, s = math.cos(yaw), math.sin(yaw)
        corners = []
        for x, z in ((-w / 2, -d / 2), (-w / 2, d / 2), (w / 2, d / 2), (w / 2, -d / 2)):
            corners.append(convert((px + x * c - z * s, py, pz + x * s + z * c)))
        top = convert((px, py + h, pz))
        quad = [(p[0], p[2]) for p in corners]
        y0, y1 = corners[0][1], top[1]
        out.append((m, (quad, min(y0, y1), max(y0, y1))))
    return out


def _record(vol, flags, ambient):
    lo, hi = volume_box(vol)
    amb = (ambient,) * 3
    fog = (0.0, 0.0, 0.0)
    # +0 unused, +4 box min, +16 box max, +28 filled in at load, +32 flags,
    # +36 ambient, +48 character ambient, +60 fog colour, +72 fog strength/start/end, +84 blend time.
    rec = struct.pack('>I3f3fII3f3f3f3ff', 0, *lo, *hi, 0, flags, *amb, *amb, *fog, 0.0, 0.0, 0.0, BLEND)
    assert len(rec) == 88
    return rec


def _block(vol):
    """A region's plane block: its planes and a chain over them (each node tests one plane and goes on to the next
    while the point is inside), as retail stores them."""
    planes = volume_planes(vol)
    out = bytearray(struct.pack('>4I', len(planes), len(planes), 0, 0))
    for p in planes:
        out += struct.pack('>4f', *p)
    for i in range(len(planes)):
        out += struct.pack('>3H', i, 0, i + 1 if i + 1 < len(planes) else 0)
    return bytes(out)


def _join(records, blocks):
    out = bytearray(struct.pack('>I', len(records)))
    for r in records:
        out += r
    for b in blocks:
        out += b'\0' * (-len(out) % 4)
        out += b
    return bytes(out)


def section(regions):
    """The region section's bytes for [(volume, flags, ambient)]."""
    return _join([_record(vol, flags, ambient) for vol, flags, ambient in regions], [_block(vol) for vol, _, _ in regions])


def _split(data):
    """An existing region section as stored: its 88-byte records and each region's plane block."""
    if len(data) < 4:
        return [], []
    n = struct.unpack_from('>I', data, 0)[0]
    records = [bytes(data[4 + 88 * i:4 + 88 * i + 88]) for i in range(n)]
    blocks, at = [], 4 + 88 * n
    for _ in range(n):
        at += -at % 4
        planes, nodes = struct.unpack_from('>2I', data, at)
        size = 16 + 16 * planes + 6 * nodes
        blocks.append(bytes(data[at:at + size]))
        at += size
    if at > len(data) or any(data[at:]):
        raise RuntimeError("the map's region list could not be read")
    return records, blocks


# ------------------------------------------------------------ the minimap's region --
#
# The HUD minimap and the pause map only use a map's minimap floors (minimap_region.py) while the camera is inside
# one of these regions: the floor choice (0x822E8140) gives up when the region the camera is in (0x8370CFB4, found
# by 0x820FC458 from this list) is none. Every retail map has one over the whole map; a custom map has none, so its
# minimap stays black. MAP_REGION is that one: a box over the whole map with no effects of its own (flags 0: no
# light, rain or sky change), put last so rain blockers and rooms inside it keep their own look.
MAP_REGION_FLAGS = 0


COVER_SLACK = 0.01  # metres: the chunk stores 32-bit floats, so 59.52 reads back as 59.5199996


def covered(chunk_bytes, x0, x1, z0, z1, y0=None, y1=None):
    """Whether a region of the chunk covers the whole of x0..x1, z0..z1 (game metres, to the centimetre), and of
    y0..y1 when given (a roofed room's box covers its floor plan, not the map's height)."""
    e = COVER_SLACK
    for lo, hi, _ in read_regions(chunk_bytes):
        if lo[0] <= x0 + e and hi[0] >= x1 - e and lo[2] <= z0 + e and hi[2] >= z1 - e \
                and (y0 is None or lo[1] <= y0 + e) and (y1 is None or hi[1] >= y1 - e):
            return True
    return False


def insert(chunk_bytes, new, at=None, what='the regions'):
    """Chunk bytes with regions [(volume, flags, ambient)] put into the list before index `at` (at the end when
    None); the ones there stay byte for byte. Checks that nothing else changed and that every region reads back."""
    ch = rc.read_chunk(chunk_bytes)
    records, blocks = _split(bytes(ch.get(SECTION).data))
    if len(records) + len(new) > MAX_REGIONS + 1:
        raise RuntimeError('the map has no room for more regions')
    at = len(records) if at is None else at
    before = {s.name: bytes(s.data) for s in ch.secs}
    ch.get(SECTION).data = bytearray(_join(records[:at] + [_record(v, f, a) for v, f, a in new] + records[at:],
                                           blocks[:at] + [_block(v) for v, _, _ in new] + blocks[at:]))
    out = rc.write_chunk(ch)
    check = rc.read_chunk(out)
    for s in check.secs:
        if s.name != SECTION and bytes(s.data) != before[s.name]:
            raise RuntimeError(f'adding {what} changed another part of the map: ' + s.name)
    got_records, got_blocks = _split(bytes(check.get(SECTION).data))
    n = len(new)
    if got_records[:at] + got_records[at + n:] != records or got_blocks[:at] + got_blocks[at + n:] != blocks \
            or len(got_records) != len(records) + n:
        raise RuntimeError(f'{what} did not read back')
    return bytes(out)


def with_map_region(chunk_bytes, x0, x1, z0, z1, y0, y1):
    """Chunk bytes with a map-wide region over x0..x1, y0..y1, z0..z1 added after the regions it has (see above).
    Checks that nothing else changed and that every region reads back."""
    vol = ([(x0, z0), (x0, z1), (x1, z1), (x1, z0)], y0, y1)
    out = insert(chunk_bytes, [(vol, MAP_REGION_FLAGS, 0.0)], what='the map region')
    if not covered(out, x0, x1, z0, z1):
        raise RuntimeError('the map region did not read back')
    return out


def read_regions(chunk_bytes):
    """[(lo, hi, flags)] of the regions in a chunk (for checks)."""
    ch = rc.read_chunk(chunk_bytes)
    data = bytes(ch.get(SECTION).data)
    if len(data) < 4:
        return []
    n = struct.unpack_from('>I', data, 0)[0]
    out = []
    for i in range(n):
        o = 4 + 88 * i
        v = struct.unpack_from('>3f3fII', data, o + 4)
        out.append((v[0:3], v[3:6], v[7]))
    return out


def write_regions(chunk_bytes, regions):
    """Chunk bytes with the regions written in; checks nothing else changed and that they read back."""
    ch = rc.read_chunk(chunk_bytes)
    old = bytes(ch.get(SECTION).data)
    if len(old) >= 4 and struct.unpack_from('>I', old, 0)[0]:
        raise RuntimeError('the map template already has regions')
    before = {s.name: bytes(s.data) for s in ch.secs}
    ch.get(SECTION).data = bytearray(section(regions))
    out = rc.write_chunk(ch)
    check = rc.read_chunk(out)
    for s in check.secs:
        if s.name != SECTION and bytes(s.data) != before[s.name]:
            raise RuntimeError('adding regions changed another part of the map: ' + s.name)
    got = read_regions(out)
    if len(got) != len(regions):
        raise RuntimeError('regions did not read back')
    return bytes(out)


def add_regions(chunk_path, markers, world_scale, convert, always_clear, log, dry=()):
    """Writes the map's rain blockers and indoor rooms into its chunk, and `dry`, rain blockers over its roofed
    floor (interiors.py, game frame boxes, biggest first: the smallest go when the list is full); returns how many."""
    usable = []
    for m, vol in region_volumes(markers, world_scale, convert):
        quad, y0, y1 = vol
        name = m.get('label') or m.get('type')
        sides = [math.dist(quad[i], quad[(i + 1) % 4]) for i in range(4)]
        if not all(math.isfinite(v) for p in quad for v in p) or not (math.isfinite(y0) and math.isfinite(y1)):
            log(f'{name}: invalid position. Skipped.')
        elif min(sides) < MIN_SIDE or y1 - y0 < MIN_SIDE:
            log(f'{name}: smaller than {MIN_SIDE} m. Skipped.')
        else:
            ambient = float(m.get('ambient', DEFAULT_AMBIENT) or DEFAULT_AMBIENT)
            usable.append((vol, FLAGS[m['type']], max(0.0, min(1.0, ambient))))
    if len(usable) > MAX_REGIONS:
        log(f'Regions: only the first {MAX_REGIONS} are written ({len(usable)} placed).')
        usable = usable[:MAX_REGIONS]
    placed = len(usable)
    dry = list(dry)[:MAX_REGIONS - placed]
    usable += [(interiors.volume(b), FLAG_INDOOR, 0.0) for b in dry]
    if not usable:
        return 0
    # The first box the camera is in wins: smaller ones first, so a room inside a bigger blocker keeps its own look.
    usable.sort(key=lambda r: (lambda lo, hi: (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]))(*volume_box(r[0])))
    path = Path(chunk_path)
    path.write_bytes(write_regions(path.read_bytes(), usable))
    blockers = sum(1 for r in usable if r[1] == FLAGS[RAIN_BLOCKER]) - len(dry)
    if placed:
        log(f'Regions: {blockers} rain blocker(s), {placed - blockers} indoor room(s) (new, not yet tried in game).')
    if dry:
        log(f'Dry interiors: {len(dry)} box(es) over the floor under roofs and ceilings, where rain now stops (new, not yet tried in game).')
    if always_clear and blockers:
        log('Note: this map is always clear, so there is no rain to block; rain blockers matter when the weather changes each match.')
    return len(usable)
