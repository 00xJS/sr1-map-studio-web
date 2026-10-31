"""Climb ledges in a map chunk: the two sections the stock loader reads for them.

Kewizzle worked out this layout for his SR1 Studio; this is our own writer, built
from the checks in research reports BC section 3 and BD section 3 (the stock
loader, and all 1,055 ledges of the 9 retail MP chunks that have any).

rec32_348: u32 count, then 32 bytes each, big-endian:
    f32[3] end A, f32[3] end B, u8 flags, 3 zero bytes, s32 owner (-1: static).
    Flags on disk: bit 0 picks the climb, 1 "grip to stand" (pull up and stand on
    top), 0 "grip to flip" (vault over, and refused where a top surface reaches
    0.5 m behind the edge). Value 2 is the loader's "active" bit, set on load.
kdtree356: u32 presence. 0: no tree, and the section is those 4 bytes. Otherwise
    element size 4, two pointer slots the loader fills in, the root node, then the
    node data depth first. A node is s32 count, f32[3] min, f32[3] max, u32 pointer
    slot. Count 0: its two child nodes come next at the cursor, then child 0's data,
    then child 1's. Count > 0: that many u32 record indices. Count < 0: empty.

Ledges have no facing (the game turns them to the player), so end order means
nothing, and sloped ledges are fine. A ledge must have some horizontal length:
the game divides by it without a check.
"""
import math
import struct

import sr_reborn_core as rc

RECORDS, TREE = 'rec32_348', 'kdtree356'
RECORD, NODE = 32, 32
GRIP_TO_FLIP, GRIP_TO_STAND = 0, 1
STATIC = -1
LEAF = 4  # most records a tree leaf holds (retail: usually up to 4)
MIN_RUN = 1e-3  # metres of horizontal length below which a ledge counts as having none


def encode(ledges):
    """(rec32_348 bytes, kdtree356 bytes) for [(end A, end B, flags, owner)]."""
    if not ledges:
        return bytes(4), bytes(4)
    records = bytearray(struct.pack('>I', len(ledges)))
    for a, b, flags, owner in ledges:
        records += struct.pack('>6fB3xi', *a, *b, flags, owner)
    tree = bytearray(struct.pack('>4I', 1, 4, 0, 0)) + bytes(NODE)

    def fill(at, indices):
        points = [p for i in indices for p in ledges[i][:2]]
        lo = [min(p[k] for p in points) for k in range(3)]
        hi = [max(p[k] for p in points) for k in range(3)]
        if len(indices) <= LEAF:
            struct.pack_into('>i6fI', tree, at, len(indices), *lo, *hi, 0)
            for i in indices:
                tree.extend(struct.pack('>I', i))
            return
        struct.pack_into('>i6fI', tree, at, 0, *lo, *hi, 0)
        axis = max(range(3), key=lambda k: hi[k] - lo[k])
        ordered = sorted(indices, key=lambda i: (ledges[i][0][axis] + ledges[i][1][axis], i))
        half = len(ordered) // 2
        children = len(tree)
        tree.extend(bytes(2 * NODE))
        fill(children, ordered[:half])
        fill(children + NODE, ordered[half:])

    fill(16, list(range(len(ledges))))
    return bytes(records), bytes(tree)


def _check_tree(tree, ledges):
    """Walks the tree as the loader does; raises unless it is whole and every record sits in it once."""
    if len(tree) < 48 or rc.U32(tree, 0) < 1 or rc.U32(tree, 4) != 4:
        raise ValueError('Climb ledge tree header is not understood.')
    seen = []

    def walk(at, cursor, parent):
        if at + NODE > len(tree):
            raise ValueError('Climb ledge tree runs past its section.')
        count = rc.I32(tree, at)
        lo = struct.unpack_from('>3f', tree, at + 4)
        hi = struct.unpack_from('>3f', tree, at + 16)
        if count >= 0 and not all(math.isfinite(v) for v in (*lo, *hi)):
            raise ValueError('Climb ledge tree has bounds that are not numbers.')
        if count >= 0 and parent and any(lo[k] < parent[0][k] or hi[k] > parent[1][k] for k in range(3)):
            raise ValueError('Climb ledge tree has a child outside its parent.')
        if count < 0:
            return cursor
        if count == 0:
            end = walk(cursor, cursor + 2 * NODE, (lo, hi))
            return walk(cursor + NODE, end, (lo, hi))
        if cursor + 4 * count > len(tree):
            raise ValueError('Climb ledge tree runs past its section.')
        for i in range(count):
            index = rc.U32(tree, cursor + 4 * i)
            if index >= len(ledges):
                raise ValueError('Climb ledge tree names a ledge that does not exist.')
            seen.append(index)
            for p in ledges[index][:2]:
                if any(p[k] < lo[k] or p[k] > hi[k] for k in range(3)):
                    raise ValueError('Climb ledge lies outside its tree leaf.')
        return cursor + 4 * count

    if walk(16, 48, None) != len(tree):
        raise ValueError('Climb ledge tree does not fill its section.')
    if sorted(seen) != list(range(len(ledges))):
        raise ValueError('Climb ledge tree does not hold every ledge exactly once.')


def parse(records, tree, owners=None):
    """[(end A, end B, flags, owner)] from the two sections; raises ValueError if the game could not use them.

    `owners`: how many static records the chunk has, for checking owner indices."""
    records, tree = bytes(records), bytes(tree)
    if len(records) < 4 or len(records) != 4 + rc.U32(records, 0) * RECORD:
        raise ValueError('Climb ledge records do not match their count.')
    ledges = []
    for i in range(rc.U32(records, 0)):
        *points, flags, owner = struct.unpack_from('>6fB3xi', records, 4 + RECORD * i)
        a, b = tuple(points[:3]), tuple(points[3:])
        if records[4 + RECORD * i + 25:4 + RECORD * i + 28] != bytes(3) or flags & ~3:
            raise ValueError(f'Climb ledge {i} has unknown flags.')
        if not all(math.isfinite(v) for v in points):
            raise ValueError(f'Climb ledge {i} has an end that is not a number.')
        if math.hypot(a[0] - b[0], a[2] - b[2]) < MIN_RUN:
            raise ValueError(f'Climb ledge {i} has no horizontal length: the game would divide by zero.')
        if owner < STATIC or (owners is not None and owner >= owners):
            raise ValueError(f'Climb ledge {i} names an owner that does not exist.')
        ledges.append((a, b, flags, owner))
    if not ledges:
        if rc.U32(tree, 0) != 0 or len(tree) != 4:
            raise ValueError('A chunk with no climb ledges must have an empty ledge tree.')
        return ledges
    _check_tree(tree, ledges)
    return ledges


def read(chunk):
    """The ledges of a chunk from sr_reborn_core.read_chunk, checked."""
    return parse(chunk.get(RECORDS).data, chunk.get(TREE).data, rc.U32(chunk.header, 868))


def write(chunk, ledges):
    """Replaces the chunk's ledges (only these two sections change; write_chunk rewrites the directory)."""
    records, tree = encode(ledges)
    chunk.get(RECORDS).data = bytearray(records)
    chunk.get(TREE).data = bytearray(tree)
