"""The game's own sky, copied into the exported map from the player's game files.

Retail multiplayer maps with an outdoor sky (mp_bac_01, mp_bac_03, mp_bor_01,
mp_bor_02, mp_coop_delivery) and the city's always-loaded chunk carry the
same five sky objects in their own chunk. Each is a named object record
pointing at an instance and a small mesh (about 35 m across) drawn with the
game's sky shaders:

    Sun          a flat disc, two untextured materials
    Moon         moon.tga + test_sphere_N.tgn, and a cf_ring_glow.tga halo
    Stars        shd_stars.tga + ds_grad_blk.tga
    Atmosphere   shd_noise_sph.tga (same dome as the stars)
    Cloud Layer  cloud_sparse_hz.tga + cloud_hz_noise.tga and
                 cloud_cirrus_01.tga + cloud_msk_noise.tga

The chunk lists their record numbers in the u16 section after the record
tree (header +0x3A8 holds the count). The renderer draws those records in a
pass of their own, gated by the R_skybox console switch, and the dome must
follow the camera: the city's one dome near (118, 0, -17) covers a 4.7 km city.
The record tree leaves them out. ds_grad_blk.tga is not in the map's texture
file: the game keeps it loaded all the time (always_loaded.peg_xbox2).

At export the editor reads mp_bac_01's chunk and the sky's pictures from the
player's mp_city_stream.vpp_xbox2 (nothing from the game is stored or shipped
with the site); extract() copies the five objects into a small folder once per
tab, and add() puts them into the exported map: free object records,
instances, meshes and vertex buffers of the map template, the materials and
their texture-link records, the pictures, the sky list. The template's fake
sky box is emptied afterwards, so when anything is missing the map keeps the
fake sky image. Runs after every other change to the chunk: the shared
picture name has no entry in the map's texture file.

Built on the upstream exporter (studio-py, kewizzle's SR1 Map Studio): the
chunk reader and writer in sr_reborn_core.py (from whompay's Saints Reborn
map converter), the free-slot rules of sr1_native_glass.transplant and its
texture-file append. Nothing here has been tried in game yet.
"""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

import sr_reborn_core as rc
import sr_reborn_bridge as bridge
import peg_xbox2_beaver as peg

DONOR = Path('/work/game/native_sky')
NAMES = ('Sun', 'Moon', 'Stars', 'Atmosphere', 'Cloud Layer')
LIST_COUNT = 936  # header offset of the sky list's length (0x3A8)
STATIC = 0x10000000
FAKE_SKY = 'bc_sky_baked.tga'

h = lambda b: bytes(b).hex()
unh = bytearray.fromhex


# ------------------------------------------------------------ reading --

def sky_list(ch):
    s = ch.get('u16_936').data
    return [rc.U16(s, 2 * i) for i in range(rc.U32(ch.header, LIST_COUNT))]


def record_names(ch):
    recs, n = ch.get('static_records').data, rc.U32(ch.header, 868)
    return [x.decode('latin1') for x in bytes(recs[80 * n:]).split(b'\0')[:n]]


def tree_lists(sec):
    """The record tree: node count, where the nodes start, and each node's list of record numbers."""
    n = rc.U32(sec, 0)
    at = rc.Al(4, 64)
    c, lists = at + 44 * n, []
    for i in range(n):
        k = rc.U32(sec, at + 44 * i + 12)
        lists.append([rc.U16(sec, c + 2 * j) for j in range(k)])
        c += 2 * k
    return n, at, lists


def drop_from_tree(sec, records):
    """The record tree without the given records (the sky is drawn on its own, like retail)."""
    n, at, lists = tree_lists(sec)
    out = bytearray(sec[:at + 44 * n])
    for i, items in enumerate(lists):
        keep = [r for r in items if r not in records]
        rc.Wr32(out, at + 44 * i + 12, len(keep))
        for r in keep:
            rc.Put16(out, r)
    return out


def extract(chunk_path, out_dir):
    """Copies the five sky objects out of the player's chunk into out_dir/sky.json. Returns its summary."""
    ch = rc.read_chunk(Path(chunk_path).read_bytes())
    g = rc.chunk_geometry(ch)
    strings = rc.chunk_strings(ch)
    names = record_names(ch)
    recs, inst = ch.get('static_records').data, ch.get('instances').data
    ids = sky_list(ch)
    if sorted(names[r] for r in ids) != sorted(NAMES):
        raise ValueError(f'{Path(chunk_path).name} does not have the five sky objects.')
    blocks = rc.parse_mopp_blocks(g.coll)
    objects, meshes, vbs, mats = [], [], [], []
    for r in ids:
        rec = recs[80 * r:80 * r + 80]
        ii = rc.U32(rec, 60)
        me = rc.U32(inst, 112 * ii + 104)
        m = g.meshes[me]
        if m.has48 or blocks[me]['code'] or rc.U32(ch.get('a164').data, 16 * me + 4):
            raise ValueError('Unexpected sky mesh layout.')
        if me not in meshes:
            meshes.append(me)
        for s in m.subs:
            vi = rc.U32(s.s16, 8)
            if vi not in vbs:
                vbs.append(vi)
            for b in range(rc.U16(s.s16, 2)):
                k = rc.U16(s.b16, 8 * b + 6)
                if k not in mats:
                    mats.append(k)
        objects.append({'name': names[r], 'record': h(rec), 'instance': h(inst[112 * ii:112 * ii + 112]), 'mesh': meshes.index(me)})

    def sub(s):
        return {'s16': h(s.s16), 'b16': h(s.b16), 'has12': s.has12, 's12': h(s.s12), 'b12': h(s.b12)}

    def material(k):
        M = g.mats[k]
        key = rc.U32(M.m, 4)
        params = [strings[rc.U32(M.parts[0], 12 * j + 4)] for j in range(rc.U16(M.m, 10))]
        ents = [h(E.e) for E in g.ents if rc.U32(E.e, 4) == key]
        return {'m': h(M.m), 'parts': [h(p) for p in M.parts], 'textures': params, 'ents': ents}

    sky = {
        'source': Path(chunk_path).name,
        'objects': objects,
        'meshes': [{'hdr': h(g.meshes[k].hdr), 'subs': [sub(s) for s in g.meshes[k].subs], 'a164': h(ch.get('a164').data[16 * k:16 * k + 16])} for k in meshes],
        'vbs': [{'desc': h(g.vbs[k].desc), 'aux': g.auxflag[k], 'aux_header': h(g.vbs[k].aux_header), 'aux_a': h(g.vbs[k].aux_a),
                 'aux_b': h(g.vbs[k].aux_b), 'ib': h(g.vbs[k].ib), 'vd': h(g.vbs[k].vd)} for k in vbs],
        'mesh_vbs': [[vbs.index(rc.U32(s.s16, 8)) for s in g.meshes[k].subs] for k in meshes],
        'materials': [material(k) for k in mats],
        'mesh_materials': [[[mats.index(rc.U16(s.b16, 8 * b + 6)) for b in range(rc.U16(s.s16, 2))] for s in g.meshes[k].subs] for k in meshes],
    }
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'sky.json').write_text(json.dumps(sky))
    return {'objects': [o['name'] for o in objects], 'meshes': len(meshes), 'materials': len(mats), 'textures': texture_names(sky)}


def texture_names(sky):
    seen = []
    for M in sky['materials']:
        for t in M['textures']:
            if t not in seen:
                seen.append(t)
    return seen


def have_donor(donor_dir):
    d = Path(donor_dir) if donor_dir else None
    return bool(d and (d / 'sky.json').is_file() and (d / 'textures.json').is_file())


def prepare(spec, log):
    """The sky folder for this export, made once per tab from the files the editor passed in, or None."""
    src = spec.get('native_sky_source') or {}
    donor = Path(src.get('dir') or DONOR)
    if have_donor(donor):
        return donor
    chunk = src.get('chunk')
    if not chunk or not Path(chunk).is_file() or not (donor / 'textures.json').is_file():
        return None
    try:
        extract(chunk, donor)
        return donor
    except Exception as exc:  # a game file we cannot read should not stop the export
        log("Sky: could not read the game's sky from your game files: " + str(exc))
        return None
    finally:
        try:
            Path(chunk).unlink()  # only needed for the extraction
        except OSError:
            pass


# ------------------------------------------------------------- adding --

def _free_slots(ch, g):
    """Unused object records (with their instances), meshes and vertex buffers of the map template, as the glass transplant finds them."""
    recs, inst = ch.get('static_records').data, ch.get('instances').data
    count, n_inst = rc.U32(ch.header, 868), len(inst) // 112
    refs = Counter(rc.I32(recs, 80 * r + 60) for r in range(count))
    has_geometry = lambda k: any(rc.U16(s.s16, 2) for s in g.meshes[k].subs)
    records = [(r, rc.I32(recs, 80 * r + 60)) for r in range(count)
               if 0 <= rc.I32(recs, 80 * r + 60) < n_inst and refs[rc.I32(recs, 80 * r + 60)] == 1
               and rc.U32(recs, 80 * r + 32) & STATIC and not has_geometry(rc.U32(inst, 112 * rc.I32(recs, 80 * r + 60) + 104))]
    used_meshes = {rc.U32(inst, 112 * i + 104) for i in range(n_inst)}
    blocks = rc.parse_mopp_blocks(g.coll)
    meshes = [k for k in range(len(g.meshes) - 1, -1, -1) if k not in used_meshes and not g.meshes[k].has48
              and not has_geometry(k) and not blocks[k]['code'] and not rc.U32(ch.get('a164').data, 16 * k + 4)]
    used_vbs = {rc.U32(s.s16, 8) for m in g.meshes for s in m.subs}
    vbs = [k for k in range(len(g.vbs) - 1, -1, -1) if k not in used_vbs]
    return records, meshes, vbs


def _fake_sky_meshes(g, strings):
    """Meshes drawn with the template's fake sky picture."""
    if FAKE_SKY not in strings:
        return []
    idx = strings.index(FAKE_SKY)
    mats = {k for k, M in enumerate(g.mats) if any(rc.U32(M.parts[0], 12 * j + 4) == idx for j in range(rc.U16(M.m, 10)))}
    return [k for k, m in enumerate(g.meshes) if any(rc.U16(s.b16, 8 * b + 6) in mats for s in m.subs for b in range(rc.U16(s.s16, 2)))]


def add(chunk_path, peg_path, donor_dir, log):
    """Adds the game's sky to the exported map. Returns True when it went in, False (map unchanged) when it did not fit."""
    import sr1_native_glass as glass  # PEG append helper of the upstream exporter

    donor = Path(donor_dir)
    sky = json.loads((donor / 'sky.json').read_text())
    pictures = json.loads((donor / 'textures.json').read_text())
    chunk_path, peg_path = Path(chunk_path), Path(peg_path)
    original = chunk_path.read_bytes()
    ch = rc.read_chunk(original)
    g = rc.chunk_geometry(ch)
    if sky_list(ch):
        raise ValueError('The map already has a sky list.')
    strings = rc.chunk_strings(ch)
    _, _, existing = peg.parse_peg(peg_path)
    records, mesh_slots, vb_slots = _free_slots(ch, g)
    need = (len(sky['objects']), len(sky['meshes']), len(sky['vbs']))
    if len(records) < need[0] or len(mesh_slots) < need[1] or len(vb_slots) < need[2]:
        log(f"Sky: the map has no room left for the game's sky (needs {need[0]} objects, {need[1]} meshes, {need[2]} vertex buffers; "
            f'{len(records)}, {len(mesh_slots)}, {len(vb_slots)} free); using the fake sky image instead. Fewer props or materials make room.')
        return False
    keys = {rc.U32(M.m, 4) for M in g.mats}
    if any(rc.U32(unh(M['m']), 4) in keys for M in sky['materials']):
        raise ValueError('Sky material key already in the map.')
    recs, inst = ch.get('static_records').data, ch.get('instances').data
    count = rc.U32(ch.header, 868)
    hashes = {rc.U32(recs, 80 * r + 40) for r in range(count)}

    # Pictures: names the map lacks are added; the shared ones only as names.
    by_name = {t['name'].lower(): t for t in pictures['textures']}
    have = {e.name.lower() for e in existing}
    index, additions, added, shared = {}, [], [], []
    for name in texture_names(sky):
        if name in strings:
            index[name] = strings.index(name)
            continue
        index[name] = rc.add_strings(ch, [name])[0]
        strings.append(name)
        t = by_name.get(name.lower())
        if t is None or name.lower() in have:
            shared.append(name)
            continue
        data = (donor / t['file']).read_bytes()
        if len(data) != t['bytes']:
            raise ValueError('Sky picture changed: ' + name)
        additions.append((unh(t['entry']), data))
        added.append(t['name'])

    # Materials and their texture-link records.
    first_mat = len(g.mats)
    for M in sky['materials']:
        mat = rc.Material(unh(M['m']), [unh(p) for p in M['parts']])
        for j, name in enumerate(M['textures']):
            rc.Wr32(mat.parts[0], 12 * j + 4, index[name])
        g.mats.append(mat)
        for e in M['ents']:
            ent = rc.MaterialEntry(unh(e), bytearray(4 * rc.U16(unh(e), 8)))
            g.ents.append(ent)
    rc.Wr16(g.mathdr, 0, len(g.mats))
    bridge._sort_and_validate_material_resource_links(g)

    # Vertex buffers and meshes, into free slots.
    vbs = vb_slots[:need[2]]
    for slot, V in zip(vbs, sky['vbs']):
        g.vbs[slot] = rc.VertexBuffer(unh(V['desc']), bool(V['aux']), unh(V['aux_header']), unh(V['aux_a']), unh(V['aux_b']), unh(V['ib']), unh(V['vd']))
        g.auxflag[slot] = V['aux']
    meshes = mesh_slots[:need[1]]
    for j, (slot, M) in enumerate(zip(meshes, sky['meshes'])):
        mesh = rc.Mesh(False, bytearray(), unh(M['hdr']), [])
        for si, S in enumerate(M['subs']):
            s = rc.SubMesh(unh(S['s16']), unh(S['b16']), S['has12'], unh(S['s12']), unh(S['b12']))
            rc.Wr32(s.s16, 8, vbs[sky['mesh_vbs'][j][si]])
            for b, k in enumerate(sky['mesh_materials'][j][si]):
                rc.Wr16(s.b16, 8 * b + 6, first_mat + k)
            mesh.subs.append(s)
        g.meshes[slot] = mesh
        ch.get('a164').data[16 * slot:16 * slot + 16] = unh(M['a164'])

    # Objects: the dome keeps its shape, centred on the map (the game draws it around the camera anyway).
    lo = [rc.F32(g.vec24, 4 * a) for a in range(3)]
    hi = [rc.F32(g.vec24, 12 + 4 * a) for a in range(3)]
    stars = next(o for o in sky['objects'] if o['name'] == 'Stars')
    at = [rc.F32(unh(stars['instance']), 4 + 4 * a) for a in range(3)]
    shift = [(lo[a] + hi[a]) / 2 - at[a] for a in range(3)]
    names = [x.encode('latin1') for x in record_names(ch)]
    used = []
    for (r, ii), o in zip(records, sky['objects']):
        rec, instance = unh(o['record']), unh(o['instance'])
        if rc.U32(rec, 40) in hashes:
            raise ValueError('Sky object hash already in the map: ' + o['name'])
        for a in range(3):
            rc.WrF(instance, 4 + 4 * a, rc.F32(instance, 4 + 4 * a) + shift[a])
            rc.WrF(rec, 4 * a, rc.F32(rec, 4 * a) + shift[a])
            rc.WrF(rec, 16 + 4 * a, rc.F32(rec, 16 + 4 * a) + shift[a])
        rc.Wr32(instance, 104, meshes[o['mesh']])
        rc.Wr32(rec, 60, ii)
        inst[112 * ii:112 * ii + 112] = instance
        recs[80 * r:80 * r + 80] = rec
        names[r] = o['name'].encode('latin1')
        used.append(r)
    ch.get('static_records').data = bytearray(recs[:80 * count]) + b''.join(n + b'\0' for n in names)

    # The sky list, and the record tree without the sky (as in retail).
    lst = bytearray()
    for r in used:
        rc.Put16(lst, r)
    ch.get('u16_936').data = lst
    rc.Wr32(ch.header, LIST_COUNT, len(used))
    ch.get('tree236').data = drop_from_tree(ch.get('tree236').data, set(used))

    # The fake sky box goes dark: its mesh keeps no triangles.
    hidden = _fake_sky_meshes(g, strings)
    for k in hidden:
        for s in g.meshes[k].subs:
            rc.Wr16(s.s16, 2, 0)
            s.b16 = bytearray()
            if s.has12:
                rc.Wr16(s.s12, 2, 0)
                s.b12 = bytearray()

    rc.set_geometry(ch, g)
    output = rc.write_chunk(ch)
    _check(output, original, sky, used, meshes, hidden)
    new_peg = glass._append_peg(peg_path, additions) if additions else peg_path.read_bytes()
    staged = peg_path.with_name(peg_path.name + '.sky.tmp')
    try:
        staged.write_bytes(new_peg)
        _, _, entries = peg.parse_peg(staged)
        final = [e.name for e in entries]
        if final[:len(existing)] != [e.name for e in existing] or final[len(existing):] != added:
            raise RuntimeError('Sky pictures did not link up.')
        before = peg_path.read_bytes()
        staged.replace(peg_path)
        try:
            chunk_path.write_bytes(bytes(output))
        except Exception:
            peg_path.write_bytes(before)
            raise
    finally:
        if staged.exists():
            staged.unlink()
    log(f"Sky: the game's own sky (sun, moon, stars, clouds) from {Path(sky['source']).stem} in your game files, {len(added)} picture(s) added"
        + (f"; {', '.join(shared)} come{'s' if len(shared) == 1 else ''} from the game's always-loaded pictures" if shared else '')
        + ('; fake sky box turned off' if hidden else '') + '.')
    return True


def _check(output, original, sky, used, meshes, hidden):
    """Reads the new chunk back: the sky is listed, drawn with the copied meshes, and nothing else moved."""
    check, first = rc.read_chunk(output), rc.read_chunk(original)
    cg, fg = rc.chunk_geometry(check), rc.chunk_geometry(first)
    if cg.coll != fg.coll:
        raise RuntimeError("Adding the sky changed the map's collision.")
    for section in ('block556', 'skip388', 'rec_blob308', 'tree192', 'list372', 'nav908'):
        if check.get(section).data != first.get(section).data:
            raise RuntimeError('Adding the sky changed another part of the map: ' + section)
    if sky_list(check) != used:
        raise RuntimeError('Sky list did not read back.')
    names = record_names(check)
    recs, inst = check.get('static_records').data, check.get('instances').data
    for r, o in zip(used, sky['objects']):
        me = rc.U32(inst, 112 * rc.U32(recs, 80 * r + 60) + 104)
        if names[r] != o['name'] or me != meshes[o['mesh']]:
            raise RuntimeError('Sky object did not read back: ' + o['name'])
        verts = rc.mesh_triangles(cg, me)
        if not verts:
            raise RuntimeError('Sky mesh has no triangles: ' + o['name'])
    in_tree = {r for items in tree_lists(check.get('tree236').data)[2] for r in items}
    if in_tree & set(used):
        raise RuntimeError('Sky objects are still in the record tree.')
    for k, (a, b) in enumerate(zip(cg.meshes, fg.meshes)):
        if k not in meshes and k not in hidden and (a.hdr != b.hdr or [s.b16 for s in a.subs] != [s.b16 for s in b.subs]):
            raise RuntimeError('Adding the sky changed map mesh %d.' % k)
