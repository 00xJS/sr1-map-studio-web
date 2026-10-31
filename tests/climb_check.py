"""Checks for climb ledges: studio-py/sr1_ledges.py (the chunk sections) and py/climb.py (which edges).

Run from web/:  py -3 tests/climb_check.py   (needs numpy and Pillow)

Without anything set it builds ledges from made-up boxes, walls and curves and
reads them back. With SR1_DATA_PACK set to an unpacked SR1 Map Studio desktop
folder it also writes them into the template chunk and exports a map through
web_api.py with objects marked climbable, and reads the finished file back.
With SR1_GAME_PACKFILES set to the game's packfiles folder it also runs the
walker over the retail MP chunks, so it is known to read what the game ships.
Everything is written to a temporary folder. Nothing tries the ledges in game.

The reader here, walk(), knows the format from the research reports (BC section
3.1) and shares no code with the writer or with sr_reborn_core: it finds the two
sections through the header directory of the file itself.
"""
import json
import math
import os
import shutil
import struct
import sys
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(root / 'studio-py'), str(root / 'py')]
import sr_reborn_core as rc  # noqa: E402
import sr1_ledges as ledges  # noqa: E402
import climb  # noqa: E402

failures = []


def check(cond, what):
    print(('ok   ' if cond else 'FAIL ') + what)
    if not cond:
        failures.append(what)


def walk(chunk):
    """Independent reader: (records, leaves, stats) from a whole chunk file's bytes. Raises AssertionError on anything off."""
    assert struct.unpack_from('>I', chunk, 0)[0] == 0xBBCACA12, 'chunk magic'
    at, size = struct.unpack_from('>2I', chunk, 0xA8)
    tat, tsize = struct.unpack_from('>2I', chunk, 0xB0)
    assert at % 64 == 0 and tat % 64 == 0, 'sections are 64-byte aligned'
    n = struct.unpack_from('>I', chunk, at)[0]
    assert size == 4 + 32 * n, f'record section size {size} for {n} records'
    records = []
    for i in range(n):
        o = at + 4 + 32 * i
        a, b = struct.unpack_from('>3f', chunk, o), struct.unpack_from('>3f', chunk, o + 12)
        assert chunk[o + 25:o + 28] == bytes(3), 'padding is zero'
        records.append(dict(a=a, b=b, flags=chunk[o + 24], owner=struct.unpack_from('>i', chunk, o + 28)[0]))
    present = struct.unpack_from('>I', chunk, tat)[0]
    if not present:
        assert n == 0 and tsize == 4, 'no tree: no records, a 4-byte section'
        return records, [], dict(depth=0, most=0, tight=True)
    assert struct.unpack_from('>I', chunk, tat + 4)[0] == 4, 'element size 4'
    stats = dict(depth=0, most=0, tight=True)
    leaves = []

    def node(o, cursor, depth, parent):
        count = struct.unpack_from('>i', chunk, o)[0]
        lo, hi = struct.unpack_from('>3f', chunk, o + 4), struct.unpack_from('>3f', chunk, o + 16)
        stats['depth'] = max(stats['depth'], depth)
        if count < 0:
            return cursor
        if parent:
            assert all(parent[0][k] <= lo[k] and hi[k] <= parent[1][k] for k in range(3)), 'child inside parent'
        if count == 0:
            end = node(cursor, cursor + 64, depth + 1, (lo, hi))
            end = node(cursor + 32, end, depth + 1, (lo, hi))
            return end
        indices = struct.unpack_from(f'>{count}I', chunk, cursor)
        leaves.append(indices)
        stats['most'] = max(stats['most'], count)
        pts = [p for i in indices for p in (records[i]['a'], records[i]['b'])]
        got = tuple(min(p[k] for p in pts) for k in range(3)), tuple(max(p[k] for p in pts) for k in range(3))
        assert all(got[0][k] >= lo[k] and got[1][k] <= hi[k] for k in range(3)), 'segments inside their leaf'
        if got != (lo, hi):
            stats['tight'] = False
        return cursor + 4 * count

    end = node(tat + 16, tat + 48, 0, None)
    assert end - tat == tsize, f'the tree walk ends at {end - tat}, the section is {tsize}'
    assert sorted(i for leaf in leaves for i in leaf) == list(range(n)), 'every record in the tree once'
    return records, leaves, stats


def wrap(records, tree):
    """A bare file holding just the header directory and the two sections, for walk()."""
    head = bytearray(0x100)
    struct.pack_into('>I', head, 0, 0xBBCACA12)
    a = 0x100
    t = a + len(records) + (-(a + len(records)) % 64)
    struct.pack_into('>4I', head, 0xA8, a, len(records), t, len(tree))
    return bytes(head) + records + bytes(t - a - len(records)) + tree


def box(x0, y0, z0, x1, y1, z1):
    """Vertices and faces of a closed box (faces out, in the order OBJ winds them)."""
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return v, [t for a, b, c, d in quads for t in ((a, b, c), (a, c, d))]


def merged(*parts):
    verts, faces = [], []
    for v, f in parts:
        faces += [tuple(i + len(verts) for i in t) for t in f]
        verts += v
    return verts, faces


same = lambda p: tuple(float(x) for x in p)  # noqa: E731


def key(seg):
    return tuple(sorted(seg))


def plan(*parts, convert=same):
    verts, faces = merged(*parts)
    return climb.segments(climb.top_edges(verts, faces, convert))


# ---- The sections ----

recs, tree = ledges.encode([])
check(recs == bytes(4) and tree == bytes(4), 'no ledges: two 4-byte sections')
check(ledges.parse(recs, tree) == [], 'and they read back as none')

made = [((float(i * 3), 1.5 + (i % 4), float(i % 7)), (i * 3 + 2.5, 1.5 + (i % 4), i % 7 + 0.5), ledges.GRIP_TO_STAND, ledges.STATIC) for i in range(37)]
recs, tree = ledges.encode(made)
got, leaves, stats = walk(wrap(recs, tree))
check(len(got) == 37 and all(r['flags'] == 1 and r['owner'] == -1 for r in got), 'walker: 37 records, grip to stand, static')
check(all(math.isclose(r['a'][0], m[0][0]) and math.isclose(r['b'][2], m[1][2]) for r, m in zip(got, made)), 'walker: ends as written')
check(stats['tight'] and stats['most'] <= ledges.LEAF, f'walker: leaves of at most {ledges.LEAF}, tight bounds ({stats})')
check(stats['depth'] <= 8, f'walker: balanced ({stats["depth"]} levels for 37)')
check(struct.unpack_from('>2I', tree, 0) == (1, 4), 'tree: presence 1, element size 4')
back = ledges.parse(recs, tree)
check(len(back) == 37 and back[3][2:] == (1, -1), 'sr1_ledges reads its own back')
check(ledges.parse(*ledges.encode(back)) == back, 'and writes the same again')


def refused(what, records=None, tree_=None, owners=None):
    try:
        ledges.parse(records if records is not None else recs, tree_ if tree_ is not None else tree, owners)
    except ValueError:
        check(True, 'refused: ' + what)
    else:
        check(False, 'refused: ' + what)


def poke(data, at, value):
    d = bytearray(data)
    d[at:at + len(value)] = value
    return bytes(d)


refused('a count that does not match', records=poke(recs, 0, struct.pack('>I', 38)))
refused('a tree cut short', tree_=tree[:-4])
refused('a tree with bytes left over', tree_=tree + bytes(4))
refused('a tree naming a ledge twice', tree_=poke(tree, len(tree) - 4, struct.pack('>I', struct.unpack_from('>I', tree, len(tree) - 8)[0])))
refused('a tree naming a ledge that does not exist', tree_=poke(tree, len(tree) - 4, struct.pack('>I', 99)))
refused('records with no tree', tree_=bytes(4))
refused('a tree with no records', records=bytes(4))
refused('a ledge with no horizontal length', records=poke(recs, 4 + 12, struct.pack('>f', 0.0) + recs[8:12] + struct.pack('>f', 0.0)))
refused('flags with unknown bits', records=poke(recs, 4 + 24, b'\x05'))
refused('an owner that does not exist', owners=0, records=poke(recs, 4 + 28, struct.pack('>i', 0)))
refused('an end that is not a number', records=poke(recs, 4, struct.pack('>f', float('nan'))))


# ---- Which edges ----

# A closed box: the four edges of its top, nothing from its sides or bottom.
segs = plan(box(0, 0, 0, 6, 3, 4))
check(len(segs) == 4 and all(p[1] == 3.0 for s in segs for p in s), f'a box: its top\'s four edges ({len(segs)})')
keep, metres, left = climb.usable(segs)
check(len(keep) == 4 and left == 0 and math.isclose(metres, 2 * (6 + 4) - 8 * 0.35), f'a box: corners lose 0.35 m each way ({metres:.2f} m to grab)')

# Mirrored into the game frame: same edges, ends welded, winding does not hide the top.
mirror = lambda p: (-float(p[0]) * 0.5, float(p[1]) * 0.5, float(p[2]) * 0.5)  # noqa: E731
segs = plan(box(0, 0, 0, 6, 3, 4), convert=mirror)
check(len(segs) == 4 and all(p[1] == 1.5 and p[0] <= 0 for s in segs for p in s), 'mirrored and scaled: the top is still the top')

# A diagonal across a top is not an edge; nor is the seam of two boxes meeting with the same corners.
segs = plan(box(0, 0, 0, 3, 2, 3), box(3, 0, 0, 6, 2, 3))
check(len(segs) == 4 and not any(p[0] == 3.0 and q[0] == 3.0 for p, q in segs), 'two boxes side by side: one outline, no seam')
check(any(s[0][0] == 0.0 and s[1][0] == 6.0 or s[0][0] == 6.0 and s[1][0] == 0.0 for s in segs), 'its long sides are one segment, not two')

# Corners within a millimetre of each other share their floats exactly, however they fall on the grid.
for x in (3.0004, 3.0006):
    verts, faces = merged(box(0, 0, 0, 3, 2, 3), box(x, 0, 3, 6, 2, 6))
    ends = [p for seg in climb.segments(climb.top_edges(verts, faces, same)) for p in seg]
    check(len({p for p in ends if abs(p[0] - 3) < 0.01 and abs(p[2] - 3) < 0.01}) == 1, f'objects touching at a corner ({x}): one point, the same floats')
check(not any(math.copysign(1, v) < 0 and v == 0 for p in ends for v in p), 'no negative zero')

# A short lone edge has nowhere to grab; 0.7 m is exactly nothing; a little more is a little.
lone = lambda run: [((0.0, 2.0, 0.0), (run, 2.0, 0.0))]  # noqa: E731
check(climb.usable(lone(0.5))[0] == [] and climb.usable(lone(0.5))[2] == 1, 'a lone 0.5 m edge is left out')
check(climb.usable(lone(0.7))[0] == [], 'a lone 0.7 m edge has no place left')
check(len(climb.usable(lone(0.9))[0]) == 1 and math.isclose(climb.usable(lone(0.9))[1], 0.2), 'a lone 0.9 m edge keeps 0.2 m')

# Joined nearly straight, short pieces lend each other their ends; at a right angle they do not.
A, B, C = (0.0, 2.0, 0.0), (0.5, 2.0, 0.0), (1.0, 2.0, 0.05)
check(len(climb.usable([(A, B), (B, C)])[0]) == 2, 'two 0.5 m pieces in a line stay: the join is straight')
check(climb.usable([(A, B), (B, (0.5, 2.0, 0.5))])[0] == [], 'the same two at a right angle go: 0.35 m from each end')
at_join = climb.usable([(A, (1.0, 2.0, 0.0)), ((1.0, 2.0, 0.0), (1.0, 2.0, 1.0))])
check(math.isclose(at_join[1], 2 - 4 * 0.35), 'a right-angle join counts as two free ends')
# In line with a 0.1 m neighbour: the neighbour itself has no place left, so the long one ends up on its own.
long = (A, (2.0, 2.0, 0.0))
short = ((2.0, 2.0, 0.0), (2.1, 2.0, 0.0))
keep, metres, left = climb.usable([long, short])
check(keep == [long] and left == 1 and math.isclose(metres, 2 - 2 * 0.35), f'a short neighbour with a free end goes, and the long one loses 0.35 m there ({metres:.2f} m)')
# Between two long ones a short piece stays, and takes off what its length falls short of 0.35 m.
tail = ((2.1, 2.0, 0.0), (4.1, 2.0, 0.0))
keep, metres, left = climb.usable([long, short, tail])
check(len(keep) == 3 and math.isclose(metres, (2 - 0.35 - 0.25) + 0.1 + (2 - 0.25 - 0.35)), f'a short piece between two long ones stays ({metres:.2f} m)')
# Taking one out can strand its neighbour: the next pass catches it.
check(climb.usable([(A, B), (B, (0.5, 2.0, 0.5)), ((0.5, 2.0, 0.5), (0.5, 2.0, 0.6))])[0] == [], 'stranded neighbours go too')
# Three edges at one point: the game takes whichever it meets first, so count on none.
D = (1.0, 2.0, 0.0)
tee = [((0.0, 2.0, 0.0), D), (D, (2.0, 2.0, 0.0)), (D, (1.0, 2.0, 1.0))]
check(math.isclose(climb.usable(tee)[1], 3 - 6 * 0.35), 'a three-way join counts as free ends')

# A wall top cut into 10 cm pieces would refuse every grab; it comes out as one segment.
pieces = 40
strip = ([(i * 0.1, 2.0, z) for i in range(pieces + 1) for z in (0.0, 1.0)],
         [t for i in range(pieces) for t in ((2 * i, 2 * i + 1, 2 * i + 3), (2 * i, 2 * i + 3, 2 * i + 2))])
segs = plan(strip)
along = [s for s in segs if abs(s[0][2] - s[1][2]) < 1e-6]
check(len(along) == 2 and all(math.isclose(math.dist(*s), 4.0, abs_tol=1e-6) for s in along), f'a top cut into 10 cm pieces: long edges come out whole ({len(along)})')
# A round top: chords stray at most SAG, joined within the game's bend, so the whole ring can be grabbed.
ring = 48
disc = ([(0.0, 2.0, 0.0)] + [(4 * math.cos(2 * math.pi * i / ring), 2.0, 4 * math.sin(2 * math.pi * i / ring)) for i in range(ring)],
        [(0, i % ring + 1, (i + 1) % ring + 1) for i in range(ring)])
up = lambda v, f: np.cross(np.subtract(v[f[1]], v[f[0]]), np.subtract(v[f[2]], v[f[0]]))[1]  # noqa: E731
disc = (disc[0], [f if up(disc[0], f) > 0 else (f[0], f[2], f[1]) for f in disc[1]])
segs = plan(disc)
keep, metres, left = climb.usable(segs)
check(3 < len(segs) < ring and left == 0, f'a round top: fewer, longer segments ({len(segs)} of {ring})')
check(metres > 0.9 * 2 * math.pi * 4 - 1.2, f'and nearly all of it can be grabbed ({metres:.1f} m of {2 * math.pi * 4:.1f})')

# A wall standing on the top: its foot is not an edge when it is part of the same object.
ell = ([(0, 0, 0), (0, 0, 4), (4, 0, 4), (4, 0, 0), (0, 2, 0), (0, 2, 4), (2, 2, 4), (2, 2, 0), (2, 5, 4), (2, 5, 0), (4, 5, 4), (4, 5, 0)],
       [(4, 5, 6), (4, 6, 7), (7, 6, 8), (7, 8, 9), (9, 8, 10), (9, 10, 11)])
heights = sorted({p[1] for s in plan(ell) for p in s})
foot = [s for s in plan(ell) if s[0][0] == 2.0 and s[1][0] == 2.0 and s[0][1] == 2.0]
check(not foot, f'the foot of a wall on the top is no edge (heights {heights})')

# A sloped top: fine, as retail. A steep roof: not a top.
ramp = ([(0, 2, 0), (0, 2, 3), (6, 3, 3), (6, 3, 0)], [(0, 1, 2), (0, 2, 3)])
check(len(plan(ramp)) == 4, 'a gently sloped top keeps its edges')
steep = ([(0, 2, 0), (0, 2, 3), (6, 8, 3), (6, 8, 0)], [(0, 1, 2), (0, 2, 3)])
check(plan(steep) == [], 'a steep roof is no top')

# ---- Whether the game could climb there ----

ground = merged(([(-40, 0, -40), (-40, 0, 40), (40, 0, 40), (40, 0, -40)], [(0, 1, 2), (0, 2, 3)]))


def solid(*parts):
    v, f = merged(*parts)
    return climb._Solid(np.array([[v[i] for i in t] for t in f], dtype=np.float64))


s = solid(ground, box(0, 0, 0, 6, 1.5, 3))
check(s.ray((1, 5, 1), (0, -1, 0), 10) == 3.5, 'rays hit the top of the box')
check(s.ray((-1, 5, 1), (0, -1, 0), 10) == 5.0 and s.ray((-1, 5, 1), (0, -1, 0), 1) is None, 'and pass beside it, down to the ground, within their reach')
edge = ((0.0, 1.5, 0.0), (6.0, 1.5, 0.0))
check(climb.rate(s, edge) == 'reach', 'a 1.5 m box: in reach from the ground')
s = solid(ground, box(0, 0, 0, 6, 0.5, 3))
check(climb.rate(s, ((0.0, 0.5, 0.0), (6.0, 0.5, 0.0))) == 'low', 'a 0.5 m kerb: too near the floor')
s = solid(ground, box(0, 0, 0, 6, 5, 3))
check(climb.rate(s, ((0.0, 5.0, 0.0), (6.0, 5.0, 0.0))) == 'high', 'a 5 m wall: too high to climb from the floor, kept for a jump or a fall')
s = solid(ground, box(0, 0, 0, 6, 1.5, 3), box(0, 0, -3, 6, 1.5, 0))
check(climb.rate(s, edge) == 'low', 'the seam of two boxes that do not share corners: floor on both sides')
s = solid(ground, box(0, 0, 0, 6, 1.5, 3), box(0, 1.5, 0.3, 6, 4, 3))
check(climb.rate(s, edge) == 'blocked', 'a wall right behind the edge: no room to pull up')
s = solid(ground, box(0, 0, 0, 6, 1.5, 3), box(0, 2.0, 0, 6, 2.3, 3))
check(climb.rate(s, edge) == 'blocked', 'a slab just over the top: no room to pull up')
s = solid(ground, box(0, 0, 0, 6, 1.5, 3), box(0, 0, -0.3, 6, 3, -0.05))
check(climb.rate(s, edge) in ('wall', 'low'), f'a wall right in front of the edge: not from that side ({climb.rate(s, edge)})')


# ---- The same answers as the health checks (src/lib/analysis/ledges.ts, tests/climbLedges.test.ts) ----

for case in json.loads((root / 'tests' / 'fixtures' / 'climb_ledges.json').read_text(encoding='utf-8'))['cases']:
    v = case['verts']
    found = climb.segments(climb.top_edges(v, case['marked'], same))
    keep, metres, short, rated = climb.plan(found, climb._Solid(np.array([[v[i] for i in t] for t in case['marked'] + case['other']], dtype=np.float64)))
    got = dict(segments=len(found), kept=len(keep), short=short, metres=round(metres, 3), rated=dict(sorted(Counter(rated.values()).items())))
    check(got == case['expect'], f"shared case, {case['name']}" + ('' if got == case['expect'] else f': {got} != {case["expect"]}'))
ends = climb.segments([((0.0, 2.0, 0.0), (6.0, 2.0, 0.0)), ((0.0, 2.0, 0.0), (3.0, 2.0, 0.0)), ((3.0, 2.0, 0.0), (6.0, 2.0, 0.0))])
check(len(ends) == 1, f"two objects' edges along one line are written once ({len(ends)})")

# ---- A real chunk ----

def obj(work, name, parts):
    verts, faces = merged(*parts)
    lines = ['vt 0 0', 'usemtl m'] + [f'v {x} {y} {z}' for x, y, z in verts] + [f'f {a + 1}/1 {b + 1}/1 {c + 1}/1' for a, b, c in faces]
    p = work / name
    p.write_text('\n'.join(lines) + '\n')
    return str(p)


def sections(data):
    return {s.name: bytes(s.data) for s in rc.read_chunk(data).secs}


def sky_donor(game, folder):
    """mp_bac_01's sky as the editor hands it over (src/lib/gameSky.ts), in a temporary folder."""
    import native_sky
    import peg_xbox2_beaver as peg
    vpp = rc.Packfile(Path(game) / 'mp_city_stream.vpp_xbox2')
    folder.mkdir()
    chunk, picture = folder / 'mp_bac_01.bbchunk_xbox2', folder / 'mp_bac_01.peg_xbox2'
    chunk.write_bytes(vpp.read(chunk.name))
    picture.write_bytes(vpp.read(picture.name))
    vpp.close()
    names = native_sky.extract(chunk, folder / 'probe')['textures']
    by = {}
    for e in peg.parse_peg(picture)[2]:
        if e.payload:
            by.setdefault(e.name.lower(), e)
    donor, tex = folder / 'native_sky', []
    donor.mkdir()
    for n in names:
        e = by.get(n.lower())
        if e is not None:
            f = f'texture_{len(tex):02d}.bin'
            (donor / f).write_bytes(bytes(e.payload))
            tex.append({'name': e.name, 'entry': bytes(e.raw).hex(), 'file': f, 'bytes': len(e.payload)})
    (donor / 'textures.json').write_text(json.dumps({'source': 'mp_bac_01', 'textures': tex, 'shared': [n for n in names if n.lower() not in by]}))
    native_sky.extract(chunk, donor)
    return donor


def full_export(pack, tmp):
    import web_api
    import sr1_safe_export
    studio = tmp / 'studio'
    for name in ('reference_beavercreek', 'native_glass', 'native_props'):
        shutil.copytree(pack / name, studio / name)
    web_api.STUDIO, web_api.WORK = studio, tmp / 'work'
    import sr1_native_glass
    import sr1_native_props
    sr1_native_glass.ASSETS, sr1_native_props.ASSETS = studio / 'native_glass', studio / 'native_props'
    work = tmp / 'files'
    work.mkdir()

    def tex(name, color):
        p = work / name
        Image.new('RGB', (64, 64), color).save(p)
        return str(p)

    # Editor units (two to the metre). A box 1.5 m high and 3 m deep, a 2.5 m wall, a kerb, a box not marked.
    base = dict(rotation=[0, 0, 0], scale=1, alpha={}, physics_intent='Static', position=[0, 0, 0])
    g = tex('g.png', (90, 90, 90))
    plane = ([(-80, 0, -80), (-80, 0, 80), (80, 0, 80), (80, 0, -80)], [(0, 1, 2), (0, 2, 3)])
    items = [dict(base, name='Ground', path=obj(work, 'ground.obj', [plane]), textures={'m': g}),
             dict(base, name='Climb box', path=obj(work, 'box.obj', [box(10, 0, 10, 26, 3, 16)]), textures={'m': g}, climbable=True),
             dict(base, name='Wall', path=obj(work, 'wall.obj', [box(-20, 0, 10, -8, 5, 11)]), textures={'m': g}, climbable=True),
             dict(base, name='Kerb', path=obj(work, 'kerb.obj', [box(-20, 0, -20, -8, 1, -18)]), textures={'m': g}, climbable=True),
             dict(base, name='Plain box', path=obj(work, 'plain.obj', [box(30, 0, 30, 40, 3, 40)]), textures={'m': g})]
    markers = [dict(type='Shared spawn', position=[x, 0.1, -40], yaw=0, label='') for x in (-6, -2, 2, 6)]

    def export(job, its, **more):
        logs = []
        # With a minimap: its region is written after the ledges, into the same chunk.
        spec = dict(job=job, scene_items=its, markers=markers, lights=[], base_name='climbcheck', world_scale=0.5, mirror_x=True,
                    flip_obj_v=True, double_sided=False, minimap_texture=tex('mm.png', (200, 180, 60)), minimap_rect=[-80, -80, 80, 80], **more)
        r = json.loads(web_api.export_project(json.dumps(spec), logs.append))
        check(r['ok'], f'export {job}: runs' + ('' if r['ok'] else ': ' + r['error'] + '\n' + r.get('trace', '')))
        return r.get('value'), logs

    plain = [dict(it) for it in items]
    for it in plain:
        it.pop('climbable', None)
    value, logs = export('plain', plain)
    if value:
        rs, _, _ = walk((Path(value['out_dir']) / 'climbcheck.bbchunk_xbox2').read_bytes())
        check(rs == [] and value['summary']['climb_ledges'] == 0 and not any('Climb ledges' in x for x in logs), 'export: nothing marked, no ledges and nothing said')

    value, logs = export('marked', items)
    if not value:
        return
    out = Path(value['out_dir'])
    path = out / 'climbcheck.bbchunk_xbox2'
    data = path.read_bytes()
    rs, leaves, stats = walk(data)
    rs_marked = rs
    print('      log:', [x for x in logs if 'Climb ledges' in x])
    print('      walker:', len(rs), 'records,', stats)
    # The box's top outline (4) and the wall's (4; its short ends are 0.5 m, too short to keep). No kerb, nothing on the plain box.
    check(value['summary']['climb_ledges'] == len(rs) and len(rs) == 6, f'export: the box\'s 4 edges and the wall\'s 2 long ones ({len(rs)})')
    check(all(r['flags'] == ledges.GRIP_TO_STAND and r['owner'] == -1 for r in rs), 'export: every ledge is grip to stand, static')
    check(stats['tight'], 'export: tree bounds tight')
    heights = sorted({round(r['a'][1], 3) for r in rs})
    check(heights == [1.5, 2.5], f'export: at the heights in metres ({heights})')
    # Mirrored into the game frame and centred on the base map: game x = -(editor x * 0.5), as the geometry.
    tris = climb.interiors.solid_triangles(rc.read_chunk(data))
    corners = {tuple(round(float(v), 2) for v in p) for p in tris.reshape(-1, 3)}
    check(all(tuple(round(v, 2) for v in r[e]) in corners for r in rs for e in 'ab'), 'export: every end is a corner of the exported collision')
    xs = sorted({round(r[e][0], 2) for r in rs for e in 'ab'})
    check(xs == [-13.0, -5.0, 4.0, 10.0], f'export: on the box and the wall, mirrored ({xs})')
    check(len(ledges.read(rc.read_chunk(data))) == len(rs), 'export: the exporter\'s reader agrees')
    sr1_safe_export.validate_map(out, 'climbcheck')
    check(True, 'export: validate_map passes the finished map')

    plain_chunk = sections((tmp / 'work' / 'jobs' / 'plain' / 'out' / 'climbcheck.bbchunk_xbox2').read_bytes())
    marked = sections(data)
    changed = [k for k in marked if marked[k] != plain_chunk.get(k)]
    check(changed == [ledges.RECORDS, ledges.TREE], f'export: only the two ledge sections differ from the same map unmarked ({changed})')

    # validate_map stops a broken tree or an impossible ledge.
    good = bytearray(data)
    tat = struct.unpack_from('>I', data, 0xB0)[0]
    struct.pack_into('>I', good, tat + 4, 8)
    path.write_bytes(good)
    try:
        sr1_safe_export.validate_map(out, 'climbcheck')
        check(False, 'validate_map refuses a broken ledge tree')
    except ValueError as exc:
        check('tree' in str(exc), f'validate_map refuses a broken ledge tree ({exc})')
    bad = bytearray(data)
    at = struct.unpack_from('>I', data, 0xA8)[0]
    bad[at + 4 + 12:at + 4 + 24] = bad[at + 4:at + 4 + 12]
    path.write_bytes(bad)
    try:
        sr1_safe_export.validate_map(out, 'climbcheck')
        check(False, 'validate_map refuses a ledge with no length')
    except ValueError as exc:
        check('length' in str(exc), f'validate_map refuses a ledge with no length ({exc})')
    path.write_bytes(data)

    # An object made pass-through after it was marked: said in the log, and it gets none.
    gone = [dict(it) for it in items]
    gone[1]['collision_disabled'] = True
    value, logs = export('gone', gone)
    if value:
        rs, _, _ = walk((Path(value['out_dir']) / 'climbcheck.bbchunk_xbox2').read_bytes())
        check(len(rs) == 2 and any('"Climb box" is not fixed and solid' in x for x in logs), f'export: a pass-through object gets none, and says so ({len(rs)})')
    # The game's own sky is the last thing written to the chunk: the ledges stay as they were.
    if game:
        value, logs = export('sky', items, native_sky_source={'dir': str(sky_donor(game, tmp / 'sky'))})
        if value:
            after, _, stats = walk((Path(value['out_dir']) / 'climbcheck.bbchunk_xbox2').read_bytes())
            check(value['summary']['game_sky'] == 1 and after == rs_marked and stats['tight'], f"export: with the game's sky too, the same ledges (sky {value['summary']['game_sky']})")
    else:
        print("skip the export with the game's sky (set SR1_GAME_PACKFILES to run it)")
    # Only a kerb: nothing to write, the log says why, and the export still finishes.
    value, logs = export('kerb', [items[0], items[3]])
    if value:
        rs, _, _ = walk((Path(value['out_dir']) / 'climbcheck.bbchunk_xbox2').read_bytes())
        check(rs == [] and value['summary']['climb_ledges'] == 0 and any('nothing to write' in x for x in logs), 'export: only a kerb marked, nothing written, and the log says why')


pack = os.environ.get('SR1_DATA_PACK')
game = os.environ.get('SR1_GAME_PACKFILES')
if pack:
    template = (Path(pack) / 'reference_beavercreek' / 'beavercreek.bbchunk_xbox2').read_bytes()
    check(walk(template)[0] == [], 'template: no ledges of its own')
    ch = rc.read_chunk(template)
    ledges.write(ch, made)
    out = bytes(rc.write_chunk(ch))
    got, leaves, stats = walk(out)
    check(len(got) == 37 and stats['tight'], f'template: 37 ledges written, walked back ({stats})')
    before, after = sections(template), sections(out)
    check([k for k in before if before[k] != after[k]] == [ledges.RECORDS, ledges.TREE], 'template: only the two ledge sections changed')
    check(len(out) % 2048 == 0, 'template: the file still ends on its 2048-byte boundary')
    # Rewriting does not disturb them: the later steps of an export read and write the whole chunk.
    again = bytes(rc.write_chunk(rc.read_chunk(out)))
    check(again == out, 'template: read and written again, the same bytes')
    # Ledges the map has already stay, in a tree over all of them.
    ch = rc.read_chunk(out)
    ledges.write(ch, ledges.read(ch) + made[:3])
    check(len(walk(bytes(rc.write_chunk(ch)))[0]) == 40, 'template: adding to ledges already there rebuilds the tree over all')
    with tempfile.TemporaryDirectory() as t:
        full_export(Path(pack), Path(t))
else:
    print('skip template and full export (set SR1_DATA_PACK to run them)')

if game:
    # BC section 1: what each retail MP chunk holds. The walker reads every one to its last byte.
    want = {'mp_arena': 80, 'mp_bac_01': 73, 'mp_bac_03': 67, 'mp_bac_042': 28, 'mp_bor_01': 86, 'mp_bor_02': 400, 'mp_bor_03': 106,
            'mp_coop_delivery': 12, 'mplobby_01': 203, 'mp_ptp_01': 0, 'mp_ptp_02': 0, 'mp_ptp_03': 0}
    found = {}
    for pf in sorted(Path(game).glob('*.vpp_xbox2')):
        try:
            vpp = rc.Packfile(pf)
        except RuntimeError:
            continue
        for e in vpp.entries:
            stem = e.name.rsplit('.', 1)[0]
            if e.name.endswith('.bbchunk_xbox2') and stem in want and stem not in found:
                found[stem] = vpp.read(e.name)
        vpp.close()
    check(set(found) == set(want), f'retail: found the chunks ({sorted(set(want) - set(found))} missing)')
    total = 0
    for name, data in sorted(found.items()):
        rs, leaves, stats = walk(data)
        total += len(rs)
        check(len(rs) == want[name], f'retail {name}: {len(rs)} ledges walked to the last byte, every one in the tree (depth {stats["depth"]}, leaves up to {stats["most"]})')
        if name == 'mp_arena':
            check(struct.unpack_from('>I', data, 0xB4)[0] == 2224, 'retail mp_arena: tree section 2,224 bytes')
        check(len(ledges.read(rc.read_chunk(data))) == len(rs), f'retail {name}: sr1_ledges reads it too')
        if rs:
            # Our writer over retail's own records: the walker takes it, and every end stays bit-identical.
            ch = rc.read_chunk(data)
            ledges.write(ch, ledges.read(ch))
            again = walk(bytes(rc.write_chunk(ch)))
            check(again[0] == rs and again[2]['tight'], f'retail {name}: rewritten by our tree builder, same records')
    print(f'      {total} retail ledges read')
else:
    print('skip retail chunks (set SR1_GAME_PACKFILES to run them)')

print(f'\n{len(failures)} failure(s)' if failures else '\nall climb checks passed')
sys.exit(1 if failures else 0)
