"""Faster drop-ins for the exporter's slowest pure-Python geometry helpers.

Same results as the sr_reborn_core / sr_reborn_bridge originals they replace
(install() swaps the module attributes the exporter calls; studio-py/ is not
edited). Where an input is malformed, the original runs instead, so its own
error is raised.
"""
from __future__ import annotations

import copy

import numpy as np

import sr_reborn_bridge as bridge
import sr_reborn_core as rc

_original = {}
SMALL_NODE = 48   # below this many triangles the original per-node code is quicker


def _mopp_node(keys, qmn, qmx, idx):
    """sr_reborn_core._node over index array idx (the current order of L[lo:hi])."""
    n = len(idx)
    if n <= SMALL_NODE:
        L = [{'key': int(keys[i]), 'mn': qmn[i].tolist(), 'mx': qmx[i].tolist()} for i in idx]
        return _original['node'](L, 0, n)
    lo_, hi_ = qmn[idx], qmx[idx]
    ext = hi_.max(0) - lo_.min(0)
    ax = int(np.argmax(ext))                      # first of equal extents, like max(range(3), key=...)
    # Keys are unique, so this order is exactly sorted(..., key=(mn+mx, key)).
    idx = idx[np.lexsort((keys[idx], lo_[:, ax] + hi_[:, ax]))]
    h = n // 2
    A = int(qmx[idx[:h], ax].max())
    B = int(qmn[idx[h:], ax].min())
    lc = _mopp_node(keys, qmn, qmx, idx[:h])
    rcode = _mopp_node(keys, qmn, qmx, idx[h:])
    if len(lc) <= 255:
        head = bytes([0x10 + ax, A, B, len(lc)])
    else:
        if len(lc) > 65535:
            raise RuntimeError('collision tree too large')
        head = bytes([0x23 + ax, A, B, 0, 0, (len(lc) >> 8) & 255, len(lc) & 255])
    return head + lc + rcode


def build_mopp_block(items):
    """sr_reborn_core.build_mopp_block: same quantization, tree built with numpy for big nodes."""
    if not items or len({it['key'] for it in items}) != len(items):
        return _original['mopp'](items)
    mn = []; mx = []
    for a in range(3):
        mn.append(min(x['mn'][a] for x in items) - .05); mx.append(max(x['mx'][a] for x in items) + .05)
    ext = max(mx[a] - mn[a] for a in range(3)); scale = (1 << 24) / ext * .999
    qmn = []; qmx = []
    for it in items:
        lo_ = []; hi_ = []
        for a in range(3):
            lo = int((it['mn'][a] - mn[a]) * scale) >> 16; hi = (int((it['mx'][a] - mn[a]) * scale) >> 16) + 1
            lo_.append(max(0, min(255, lo))); hi_.append(max(0, min(255, hi)))
        qmn.append(lo_); qmx.append(hi_)
    keys = np.array([it['key'] for it in items], dtype=np.int64)
    code = _mopp_node(keys, np.array(qmn, dtype=np.int64), np.array(qmx, dtype=np.int64), np.arange(len(items)))
    out = bytearray(b'PPOM'); rc.Put32(out, 300)
    for x in mn:
        rc.PutF(out, x)
    rc.PutF(out, scale); rc.Put32(out, len(code)); out += code
    return out


def _dec3n(w):
    """decode_dec3n_word's normal for an array of words: (n, 3) floats."""
    q = np.stack([(w >> s) & 0x3FF for s in (0, 10, 20)], axis=-1).astype(np.int64)
    return np.where(q & 0x200, q - 0x400, q) / 511.0


def _sq(v):
    return v[:, 0] * v[:, 0] + v[:, 1] * v[:, 1] + v[:, 2] * v[:, 2]


def generic_normal_alignment(g, mesh_ids):
    """sr_reborn_bridge._generic_normal_alignment with the per-triangle arithmetic in numpy.

    Same float64 operations in the same order (left-to-right sums), so every
    alignment value is the same; the totals use Python's own sum and min.
    """
    vals = []; slivers = 0
    for k in mesh_ids:
        for S in g.meshes[k].subs:
            V = g.vbs[rc.U32(S.s16, 8)]; st = rc.U16(V.desc, 16)
            if st % 4:
                return _original['alignment'](g, mesh_ids)
            w = st // 4
            ib = np.frombuffer(bytes(V.ib), dtype='>u2').astype(np.int64)
            words = bytes(V.vd[:len(V.vd) // 4 * 4])
            f32, u32 = np.frombuffer(words, dtype='>f4'), np.frombuffer(words, dtype='>u4')
            for b in range(rc.U16(S.s16, 2)):
                first, cnt = rc.U32(S.b16, 8 * b), rc.U16(S.b16, 8 * b + 4)
                if cnt < 3:
                    continue
                if first + cnt > len(ib):
                    return _original['alignment'](g, mesh_ids)
                idx = ib[first:first + cnt]
                end = np.arange(2, cnt)
                a, bv, c = idx[end - 2], idx[end - 1], idx[end]
                keep = (a != bv) & (bv != c) & (a != c)
                odd = ((end - 2) & 1).astype(bool)
                a, bv = np.where(odd, bv, a), np.where(odd, a, bv)
                a, bv, c = a[keep], bv[keep], c[keep]
                if not len(a):
                    continue
                if max(a.max(), bv.max(), c.max()) * w + 4 > len(f32):
                    return _original['alignment'](g, mesh_ids)
                p0, p1, p2 = (f32[(q * w)[:, None] + np.arange(3)].astype(np.float64) for q in (a, bv, c))
                e1, e2 = p1 - p0, p2 - p0
                gn = np.stack([e1[:, 1] * e2[:, 2] - e1[:, 2] * e2[:, 1], e1[:, 2] * e2[:, 0] - e1[:, 0] * e2[:, 2],
                               e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]], axis=1)
                gl2, l12, l22 = _sq(gn), _sq(e1), _sq(e2)
                ok = ~((gl2 < 1e-24) | (l12 < 1e-24) | (l22 < 1e-24))
                with np.errstate(divide='ignore', invalid='ignore'):
                    sliver = ok & (gl2 / (l12 * l22) < 1.0e-12)
                slivers += int(sliver.sum())
                ok &= ~sliver
                gnn = gn[ok] / np.sqrt(gl2[ok])[:, None]
                ns = [_dec3n(u32[q[ok] * w + 3]) for q in (a, bv, c)]
                nn = ns[0] + ns[1] + ns[2]
                nl = np.sqrt(_sq(nn))
                fine = ~(nl < 1e-12)
                nn, gnn = nn[fine] / nl[fine][:, None], gnn[fine]
                vals.extend((gnn[:, 0] * nn[:, 0] + gnn[:, 1] * nn[:, 1] + gnn[:, 2] * nn[:, 2]).tolist())
    if not vals:
        return {'triangles_checked': 0, 'negative': 0, 'mean_alignment': 0.0, 'min_alignment': 0.0,
                'numerical_slivers_ignored': slivers}
    return {'triangles_checked': len(vals), 'negative': sum(1 for x in vals if x < -0.02),
            'mean_alignment': sum(vals) / len(vals), 'min_alignment': min(vals),
            'numerical_slivers_ignored': slivers}


def mesh_triangles(g, k):
    """Every non-degenerate strip triangle of mesh k: ((batch << 16) | strip index, 3 corner positions)."""
    try:
        out = []
        for S in g.meshes[k].subs:
            V = g.vbs[rc.U32(S.s16, 8)]
            st = rc.U16(V.desc, 16)
            ib = np.frombuffer(bytes(V.ib), dtype='>u2')
            vd = np.frombuffer(bytes(V.vd), dtype=np.uint8)
            for b in range(rc.U16(S.s16, 2)):
                first, cnt = rc.U32(S.b16, 8 * b), rc.U16(S.b16, 8 * b + 4)
                if cnt <= 2:
                    continue
                p = np.arange(cnt - 2, dtype=np.int64)
                at = first + p
                if at[-1] + 2 >= len(ib):
                    raise IndexError
                t = np.stack([ib[at], ib[at + 1], ib[at + 2]], axis=1).astype(np.int64)
                keep = (t[:, 0] != t[:, 1]) & (t[:, 0] != t[:, 2]) & (t[:, 1] != t[:, 2])
                t, at = t[keep], at[keep]
                if not len(t):
                    continue
                offs = st * t[:, :, None] + 4 * np.arange(3)          # (n, 3 corners, 3 axes)
                if offs.max() + 4 > len(vd):
                    raise IndexError
                pts = vd[offs[..., None] + np.arange(4)].view('>f4')[..., 0].tolist()
                keys = ((b << 16) | at).tolist()
                out.extend(zip(keys, pts))
        return out
    except (IndexError, ValueError):
        return _original['mesh_triangles'](g, k)


_links = {}


def _link_index(g):
    """Material resource-link records by key, kept up to date as clones are appended."""
    ix = _links.get(id(g))
    if ix and ix['ents'] is g.ents and ix['count'] == len(g.ents) and (not g.ents or ix['last'] is g.ents[-1]):
        return ix
    by_key = {}
    for e in g.ents:
        by_key.setdefault(rc.U32(e.e, 4), []).append(e)
    _links.clear()
    ix = _links[id(g)] = {'ents': g.ents, 'count': len(g.ents), 'last': g.ents[-1] if g.ents else None, 'by_key': by_key, 'g': g}
    return ix


def clone_material_resource_links(g, base_idx, new_material_key):
    """sr_reborn_bridge._clone_material_resource_links without rescanning every record per material."""
    ix = _link_index(g)
    old_key = rc.U32(g.mats[base_idx].m, 4)
    donors = list(ix['by_key'].get(old_key, ()))
    if not donors:
        raise RuntimeError('source material has no secondary resource-link records')
    if ix['by_key'].get(new_material_key):
        raise RuntimeError('duplicate material resource-link key 0x%08X' % new_material_key)
    for source in donors:
        item = copy.deepcopy(source)
        rc.Wr32(item.e, 4, new_material_key)
        item.x = bytearray(len(source.x))
        g.ents.append(item)
        ix['by_key'].setdefault(new_material_key, []).append(item)
    ix['count'], ix['last'] = len(g.ents), g.ents[-1]


def uninstall():
    if _original:
        rc.mesh_triangles = _original['mesh_triangles']
        bridge._clone_material_resource_links = _original['clone_links']
        rc.build_mopp_block = _original['mopp']
        bridge._generic_normal_alignment = _original['alignment']
        _original.clear()
    _links.clear()


def install():
    if _original:
        return
    _original.update(mesh_triangles=rc.mesh_triangles, clone_links=bridge._clone_material_resource_links,
                     mopp=rc.build_mopp_block, node=rc._node, alignment=bridge._generic_normal_alignment)
    rc.mesh_triangles = mesh_triangles
    bridge._clone_material_resource_links = clone_material_resource_links
    rc.build_mopp_block = build_mopp_block
    bridge._generic_normal_alignment = generic_normal_alignment
