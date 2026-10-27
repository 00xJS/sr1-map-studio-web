"""Place the tested rigid native glass prefab into fresh Beaver-backend maps.

No game hooks or scripts: every exported pane is a separate native object.
Size is fixed because visual scaling alone does not resize its Havok shape.
"""
from pathlib import Path
from collections import Counter
import copy
import math
import struct
import hashlib

import sr_reborn_core as c
import sr_reborn_bridge as bridge
import sr1_cts
import sr1_scene
import sr1_physical_materials as physical
import peg_xbox2_beaver as peg
from sr1_native_limits import MAX_NATIVE_OBJECTS, MAX_NATIVE_TRIANGLES, MIN_NATIVE_AXIS, MAX_NATIVE_AXIS

HERE = Path(__file__).resolve().parent
ASSETS = HERE / 'native_glass'
KIND = 'sr1_native_glass_3x3'
CUSTOM_KIND = 'sr1_native_custom_mesh_glass_experiment'
WOOD_MODE = 'wood'  # experimental opaque wooden render material, GLASS damage behavior
MAX_PANES = MAX_NATIVE_OBJECTS  # Shared budget; actual available native slots checked during export.
STYLES = {'Tinted glass': 'tinted', 'Solid blue test': 'blue'}
MATERIALS = {'tinted': 36, 'blue': 35}
WIDTH = 1.4931641
HEIGHT = 2.37597704


def is_glass(item):
    return item.get('native_prefab') in (KIND, CUSTOM_KIND)


def is_custom(item):
    return item.get('native_prefab') == CUSTOM_KIND


def restore_item(item):
    """Rebind bundled preview paths after moving/updating the Studio folder."""
    if is_custom(item):
        obj = Path(item.get('native_mesh_obj', item.get('path', ''))).resolve()
        if not obj.is_file():
            raise ValueError('Missing custom breakable model: ' + str(obj))
        item['native_mesh_obj'] = str(obj)
        item['path'] = str(obj)
        texture = item.get('glass_custom_texture')
        if not texture or not Path(texture).is_file():
            raise ValueError('Custom breakable model needs one assigned image texture.')
        item['glass_custom_texture'] = str(Path(texture).resolve())
        item['native_breakable_kind'] = item.get('native_breakable_kind', 'glass')
        if item['native_breakable_kind'] not in ('glass', WOOD_MODE):
            raise ValueError('Unknown breakable kind: ' + repr(item['native_breakable_kind']))
        item['physics_intent'] = ('Native breakable wood (GLASS shatter experiment)' if item['native_breakable_kind'] == WOOD_MODE
                                  else 'Native breakable custom-mesh (experimental)')
        if item.get('native_prop_behavior'):
            from sr1_native_props import PRESETS
            item['physics_intent'] = PRESETS[item['native_prop_behavior']]['label']
        return item
    style = item.get('glass_style', 'tinted')
    if style not in MATERIALS:
        raise ValueError('Unknown native glass appearance: ' + str(style))
    custom = item.get('glass_custom_texture')
    if custom:
        custom = str(Path(custom).resolve())
        if not Path(custom).is_file():
            raise ValueError('Custom glass image cannot be found: ' + custom)
    item.update(path=str(ASSETS / 'pane.obj'), source_path=str(ASSETS / 'pane.obj'),
                textures={'glass_preview': custom or str(ASSETS / (style + '.png'))},
                alpha={'glass_preview': True if custom else style == 'tinted'},
                physics_intent='Native breakable glass')
    return item


def create_item(position, world_scale, style='tinted'):
    scale = float(world_scale)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('Choose a positive export world scale before placing glass.')
    item = dict(native_prefab=KIND, glass_style=style, name='Breakable glass',
                position=list(map(float, position)), rotation=[0., 0., 0.],
                scale=1. / scale)
    return restore_item(item)


def validate_placements(items, world_scale):
    scale = float(world_scale)
    if not math.isfinite(scale) or scale <= 0:
        raise ValueError('Glass needs a positive finite world scale.')
    if len(items) > MAX_PANES:
        raise ValueError(f'Native props and glass panes support at most {MAX_PANES} objects per map in this build.')
    for item in items:
        sr1_scene.validate_pivot(item)
        if not is_glass(item):
            raise ValueError('Unsupported native prefab.')
        if item.get('glass_style', 'tinted') not in MATERIALS:
            raise ValueError('Unsupported glass appearance.')
        for key in ('position', 'rotation'):
            values = item.get(key, [])
            if len(values) != 3 or not all(math.isfinite(float(x)) for x in values):
                raise ValueError('Glass ' + key + ' must contain three finite values.')
        if is_custom(item):
            opacity = item.get('native_opacity', 100)
            if isinstance(opacity, bool) or not isinstance(opacity, (int,float)) or not math.isfinite(opacity) or opacity != int(opacity) or not 0 <= opacity <= 100:
                raise ValueError('Breakable prop opacity must be an integer between 0 and 100%.')
            if not math.isfinite(float(item.get('scale', 0))) or float(item['scale']) <= 0:
                raise ValueError('Custom breakable scale must be positive.')
            if item.get('native_breakable_kind', 'glass') == WOOD_MODE and opacity != 100:
                raise ValueError('Experimental breakable Wood must be 100% opaque; use Glass for alpha blending.')
            restore_item(item)
            continue
        if not math.isfinite(float(item.get('scale', 1))) or not math.isclose(
                float(item.get('scale', 1)) * scale, 1., abs_tol=0.0001):
            raise ValueError(
                'Breakable glass has a fixed physical size (1.49 x 2.38 game units). '
                'Use "Reset glass size" in the Scene tab after changing world scale; '
                'resizing glass collision is not supported yet.')


def export_scene_mesh(items, parser):
    """Remove previews completely, retaining ordinary objects' material IDs."""
    mesh = sr1_scene.scene_mesh(items, parser)
    prefixes = tuple('obj%03d_' % i for i, item in enumerate(items) if is_glass(item))
    if not prefixes:
        return mesh
    faces = [f for f in mesh['faces'] if not f[3].startswith(prefixes)]
    used = sorted({i for f in faces for i in f[:3]})
    remap = {old: new for new, old in enumerate(used)}
    names = {f[3] for f in faces}
    return dict(verts=[mesh['verts'][i] for i in used],
                uv0=[mesh['uv0'][i] for i in used],
                src_normals=[mesh['src_normals'][i] for i in used],
                faces=[tuple(remap[i] for i in f[:3]) + (f[3],) for f in faces],
                textures={k: v for k, v in mesh['textures'].items() if k in names},
                alpha={k: v for k, v in mesh['alpha'].items() if k in names})


def game_transform(item, world_scale, origin, mirror_x):
    # Render vertices and native collision still use the source model's local
    # coordinates. Convert its origin, not the editor's relocated gizmo pivot.
    source_origin = (sr1_scene.transform((0.,0.,0.),item)
                     if any(item.get('pivot',(0.,0.,0.))) else item['position'])
    pos = sr1_cts.convert_xyz(source_origin, world_scale, mirror_x, origin, 'scene')
    # The same Z-roll / X-pitch / Y-heading convention as the editor.
    rotation = dict(position=[0, 0, 0], rotation=item['rotation'], scale=1.)
    columns = [sr1_scene.transform(v, rotation) for v in ((1, 0, 0), (0, 1, 0), (0, 0, 1))]
    if mirror_x:
        # M R M keeps a proper rigid rotation for Havok. This prefab's box
        # is symmetric along its local X axis; no negative collider scale.
        columns = [tuple(v[j] * (-1 if j == 0 else 1) * (-1 if k == 0 else 1)
                         for j in range(3)) for k, v in enumerate(columns)]
    return pos, [v for column in columns for v in column]


def _encode_solid_texture(donor_entry, image_path, target_name):
    return _encode_custom_texture(donor_entry, image_path, target_name, False, 100)


def _encode_custom_texture(donor_entry, image_path, target_name, use_alpha, opacity=None):
    """Use the same texture sizing/encoding as static scenery, not pane size."""
    image, source_size, output_size = bridge.normalized_image(image_path, use_alpha)
    if use_alpha and opacity is not None:
        image.putalpha(image.getchannel('A').point(lambda a: int(round(a * opacity / 100.0))))
    fmt = peg.FMT_DXT5 if use_alpha else peg.FMT_DXT1
    payload, kind = bridge._encoded_payload(image, fmt)
    record = bytearray(donor_entry.raw)
    peg._write_name(record, target_name)
    struct.pack_into('>HHH', record, 4, image.width, image.height, fmt)
    record[0x14] = 1 if use_alpha else 0
    record[0x15] = 1
    record[0x16] = 1
    c.Wr32(record, 0x34, len(payload))
    record[0x38:0x48] = bytes(16)
    return record, payload


def _append_peg(path, additions):
    raw, h, entries = peg.parse_peg(path)
    built = []
    for e in entries:
        end = min([x.data_offset for x in entries if x.data_offset > e.data_offset] + [len(raw)])
        built.append((bytearray(e.raw), raw[e.data_offset:end]))
    built.extend(additions)
    directory = 24 + 72 * len(built)
    start = c.Al(directory, 4096)
    out = bytearray(start)
    for j, (entry, data) in enumerate(built):
        c.PadTo(out, 4096)
        c.Wr32(entry, 0, len(out))
        out[24 + 72 * j:96 + 72 * j] = entry
        out += data
    c.PadTo(out, 4096)
    struct.pack_into('>IHHIIHHHH', out, 0, h.signature, h.version, h.platform,
                     directory, len(out) - start, len(built), h.flags, len(built), h.alignment)
    return bytes(out)




def _orient_closed_solid(verts, faces):
    """Orient a closed imported solid without coincident backface triangles.

    OBJ/FBX exporters often duplicate vertices at UV seams and sometimes give
    adjacent polygons inconsistent winding. Connect faces by POSITION, not OBJ
    vertex indices; orient neighboring faces consistently, then pick outward
    winding by signed volume for each connected shell.

    Return None for non-manifold/open geometry: such geometry retains the old
    two-sided fallback, because an open pane really can need two sides.
    """
    from collections import defaultdict, deque
    # Fixed absolute tolerance is appropriate for exported game-space geometry
    # with an enforced 0.01 minimum native hull extent.
    coords = [tuple(round(float(q), 6) for q in v) for v in verts]
    edge_map = defaultdict(list)
    for fi, face in enumerate(faces):
        tri = face[:3]
        for ia, ib in ((0, 1), (1, 2), (2, 0)):
            a, b = coords[tri[ia]], coords[tri[ib]]
            if a == b: return None
            edge_map[tuple(sorted((a,b)))].append((fi, a, b))
    if not edge_map or any(len(e) != 2 for e in edge_map.values()):
        return None
    graph = [[] for _ in faces]
    for pair in edge_map.values():
        f0, a0, b0 = pair[0]
        f1, a1, b1 = pair[1]
        if f0 == f1: return None
        # Shared edge must be traversed in opposite directions by adjacent
        # triangle windings. XOR flags show which faces must flip.
        same_direction = (a0 == a1 and b0 == b1)
        graph[f0].append((f1, same_direction))
        graph[f1].append((f0, same_direction))
    parity = [None] * len(faces)
    shells=[]
    for seed in range(len(faces)):
        if parity[seed] is not None: continue
        parity[seed]=False
        shell=[]
        pending=deque([seed])
        while pending:
            fi=pending.popleft()
            shell.append(fi)
            for adj, opposite_parity in graph[fi]:
                want=bool(parity[fi]) ^ bool(opposite_parity)
                if parity[adj] is None:
                    parity[adj]=want
                    pending.append(adj)
                elif parity[adj] != want:
                    return None
        shells.append(shell)
    result=list(faces)
    for shell in shells:
        signed_volume=0.0
        for fi in shell:
            ia, ib, ic=result[fi][:3]
            if parity[fi]: ib, ic = ic, ib
            a,b,c=(verts[i] for i in (ia,ib,ic))
            cross=(b[1]*c[2]-b[2]*c[1], b[2]*c[0]-b[0]*c[2], b[0]*c[1]-b[1]*c[0])
            signed_volume+=sum(a[k]*cross[k] for k in range(3))/6.0
        if abs(signed_volume)<1.0e-10:
            return None
        reverse_shell=signed_volume<0.0
        for fi in shell:
            f=result[fi]
            if bool(parity[fi]) ^ reverse_shell:
                result[fi]=(f[0],f[2],f[1],f[3])
    return result


def build_custom_render(obj_path, game_scale, mirror_x, flip_obj_v=True):
    """Build solid imported props using OUTWARD face winding.

    v0.99 drew 108 front + 108 coplanar backface triangles for a closed
    crate. That creates overlapping faces in a native shader whose culling
    and depth-write behavior is not guaranteed. Closed manifold models now
    use the original triangle count, with repaired connected winding.

    Thin/open meshes still get front and back triangles pending in-game tests.
    Physics shape generation remains completely separate and unchanged.
    """
    import sr1_obj_core as oc
    obj = oc.parse_obj_attrs(obj_path)
    if not obj['verts'] or not obj['faces']:
        raise ValueError('Custom breakable has no geometry.')
    if len(obj['faces']) > MAX_NATIVE_TRIANGLES:
        raise ValueError(f'Experimental native mesh is limited to {MAX_NATIVE_TRIANGLES:,} triangles per object.')
    mats = {f[3] or 'default' for f in obj['faces']}
    if len(mats) != 1:
        raise ValueError('Experimental native mesh requires exactly ONE assigned material.')
    obj = bridge._apply_obj_export_conventions(obj, mirror_x=mirror_x, flip_v=flip_obj_v)
    verts = [tuple(float(v)*float(game_scale) for v in p) for p in obj['verts']]
    uvs = obj['uv0']
    original_faces = obj['faces']
    solid_faces = _orient_closed_solid(verts, original_faces)
    faces = solid_faces if solid_faces is not None else original_faces
    frames, _ = oc.build_vertex_frames(verts, faces, uvs, obj['src_normals'])
    V = bridge._VB24(); V.strip_mat = 0; clipped = [False]
    for f in faces:
        winds=(f[:3],) if solid_faces is not None else (f[:3], (f[2], f[1], f[0]))
        for a,b,k in winds:
            p0,p1,p2 = [verts[i] for i in (a,b,k)]
            x = tuple(p1[i]-p0[i] for i in range(3))
            y = tuple(p2[i]-p0[i] for i in range(3))
            n = (x[1]*y[2]-x[2]*y[1], x[2]*y[0]-x[0]*y[2], x[0]*y[1]-x[1]*y[0])
            length = math.sqrt(sum(t*t for t in n))
            if length < 1e-8: continue
            n = tuple(t/length for t in n)
            su = math.floor(sum((uvs[i][0] if uvs[i] else 0.) for i in (a,b,k))/3.)
            sv = math.floor(sum((uvs[i][1] if uvs[i] else 0.) for i in (a,b,k))/3.)
            ids=[]
            for i in (a,b,k):
                frame, _ = bridge._face_safe_frame(frames[i], n)
                v = bridge._pack_vertex24(verts[i], frame, uvs[i], su, sv, clipped)
                ids.append(V.vertex(v, verts[i]))
            V.strip.add(*ids); V.tris+=1
    V.flush()
    if not V.tris or V.verts > 65535 or len(V.ib)>65535:
        raise ValueError('Custom native render mesh exceeds supported limits.')
    if clipped[0]:
        raise ValueError('Custom UVs exceed SR1 compact UV range.')
    V.closed_solid = solid_faces is not None
    V.source_triangles = len(original_faces)
    return V

def _append_native_box_hull(bank, minimum, maximum):
    """EXPERIMENTAL: clone native pane's 8-vertex convex HKCM shape 26.

    Independent per-object shape records use the existing collision selector in
    source_record+56. Preserve its native connectivity/index topology; apply an
    affine axis-by-axis transform to all vertices AND supporting hull planes,
    then recompute box inertias. This is only tested structurally, not in game.
    """
    bank = bytearray(bank)
    if (bank[:4] != b'HKCM' or c.U32(bank, 4) != 3 or c.U32(bank, 8) != len(bank)):
        raise ValueError('Unexpected native HKCM collision bank header.')
    # Verified for bundled blue glass donor, which has exactly 37 shapes.
    if c.U32(bank, 12) < 37 or bank[0x3df8:0x3dfc] != b'\0\0\0\1':
        raise ValueError('Bundled glass HKCM format changed; cannot fit collider.')
    source = bank[0x3df8:0x3fd8]
    if len(source) != 480 or c.U32(source, 36) != 2 or c.U16(source, 40) != 8 or c.U32(source, 140) != 10:
        raise ValueError('Glass collision shape 26 is not the expected 8-vertex convex hull.')
    vertices = [tuple(struct.unpack_from('>3f', source, 44+12*i)) for i in range(8)]
    lo = [min(v[k] for v in vertices) for k in range(3)]
    hi = [max(v[k] for v in vertices) for k in range(3)]
    minimum, maximum = list(map(float, minimum)), list(map(float, maximum))
    sizes = [maximum[k] - minimum[k] for k in range(3)]
    if any(not math.isfinite(d) or d < MIN_NATIVE_AXIS or d > MAX_NATIVE_AXIS for d in sizes):
        raise ValueError(f'Fitted native bounds must be {MIN_NATIVE_AXIS}–{MAX_NATIVE_AXIS:g} game units per axis: '+str(sizes))
    ratios = [sizes[k]/(hi[k]-lo[k]) for k in range(3)]
    translations = [minimum[k]-ratios[k]*lo[k] for k in range(3)]
    result = bytearray(source)
    for i, v in enumerate(vertices):
        mapped = [v[k]*ratios[k]+translations[k] for k in range(3)]
        struct.pack_into('>3f', result, 44+12*i, *mapped)
    # Each 4-float plane is n.x + d <= 0. Affine inverse-transpose preserves
    # the original bevelled convex hull without changing face connectivity.
    for i in range(10):
        off=144+16*i
        nx,ny,nz,d=struct.unpack_from('>4f', source, off)
        transformed=[nx/ratios[0], ny/ratios[1], nz/ratios[2]]
        nd=d-sum(transformed[k]*translations[k] for k in range(3))
        mag=math.sqrt(sum(x*x for x in transformed))
        if mag<1e-10:raise ValueError('Invalid native collision plane.')
        struct.pack_into('>4f',result,off,*(x/mag for x in transformed),nd/mag)
    # Final 48 bytes store inertia tensor (3x3 float32) and center of mass
    # (3 floats). For a box with half-extents h: Ixx=(hy^2+hz^2)/3, etc.
    h=[d*0.5 for d in sizes]
    inertia=[(h[1]*h[1]+h[2]*h[2])/3.,
             (h[0]*h[0]+h[2]*h[2])/3.,
             (h[0]*h[0]+h[1]*h[1])/3.]
    center=[(minimum[k]+maximum[k])/2 for k in range(3)]
    struct.pack_into('>12f',result,len(result)-48,
                     inertia[0],0.,0.,0.,inertia[1],0.,0.,0.,inertia[2],*center)
    # Sanity check: all vertices satisfy the rewritten supporting planes to
    # within the same tolerance as the original Havok donor.
    for i in range(10):
        n=struct.unpack_from('>4f',result,144+16*i)
        vlist=[struct.unpack_from('>3f',result,44+12*j) for j in range(8)]
        largest=max(sum(n[k]*v[k] for k in range(3))+n[3] for v in vlist)
        if largest > 0.03:raise ValueError('Transformed Havok hull is not convex: '+str(largest))
    index=c.U32(bank,12)
    if index>=65535:raise ValueError('Too many native collision shapes.')
    bank += result
    c.Wr32(bank,8,len(bank))
    c.Wr32(bank,12,index+1)
    return bank,index


def transplant(chunk_path, peg_path, items, world_scale, origin, mirror_x, map_name, flip_obj_v=True):
    """Merge a small number of independent native pane instances into a map."""
    validate_placements(items, world_scale)
    if not items:
        return dict(native_breakables_created=0, placements=[])
    chunk_path, peg_path = Path(chunk_path), Path(peg_path)
    before = c.read_chunk(chunk_path.read_bytes())
    ch = c.read_chunk(chunk_path.read_bytes())
    g = c.chunk_geometry(ch)
    donor = c.read_chunk((ASSETS / 'prefab.bbchunk_xbox2').read_bytes())
    dg = c.chunk_geometry(donor)
    ds = c.chunk_strings(donor)
    draw, _, de = peg.parse_peg(ASSETS / 'prefab.peg_xbox2')
    _, _, existing = peg.parse_peg(peg_path)
    strings = c.chunk_strings(ch)
    if strings != [e.name for e in existing]:
        raise ValueError('Destination map texture directory is not synchronized.')
    recs, instances = ch.get('static_records').data, ch.get('instances').data
    count = c.U32(ch.header, 868)
    if count != 116 or len(g.meshes) != 119 or len(g.vbs) != 119:
        raise ValueError('Native glass requires the current Beaver-backed Studio exporter.')
    if any(c.U32(recs, i * 80 + 32) & 0x20000 for i in range(count)):
        raise ValueError('Destination already contains native damage objects; refusing to replace its physics bank.')
    if c.U32(ch.get('skip388').data, 0):
        raise ValueError('Destination already has an effect bank; automatic merging is not implemented.')
    references = Counter(c.I32(recs, i * 80 + 60) for i in range(count))
    def has_geometry(k):
        return any(c.U16(s.s16, 2) for s in g.meshes[k].subs)
    free_sources = []
    for r in range(count):
        ii = c.I32(recs, r * 80 + 60)
        if (0 <= ii < len(instances) // 112 and references[ii] == 1 and
                c.U32(recs, r * 80 + 32) & 0x10000000 and
                not has_geometry(c.U32(instances, ii * 112 + 104))):
            free_sources.append((r, ii))
    def style_key(item):
        custom = item.get('glass_custom_texture')
        if is_custom(item):
            opacity = int(item.get('native_opacity',100))
            if not 0 <= opacity <= 100:
                raise ValueError('Breakable mesh opacity must be between 0 and 100 percent.')
            payload=(Path(item['native_mesh_obj']).read_bytes()+Path(custom).read_bytes()
                     +repr((item['scale'],world_scale,mirror_x,flip_obj_v,opacity,item.get('native_breakable_kind','glass'),physical.native_surface_id(item))).encode('ascii'))
            return 'mesh_' + hashlib.sha256(payload).hexdigest()[:16]
        if custom:
            return 'custom_' + hashlib.sha256(Path(custom).read_bytes() + item.get('glass_style','tinted').encode('ascii')).hexdigest()[:16]
        return item.get('glass_style', 'tinted')
    styles = list(dict.fromkeys(style_key(item) for item in items))
    custom_style_paths = {style_key(item): item['glass_custom_texture'] for item in items if item.get('glass_custom_texture')}
    custom_mesh_items = {style_key(item): item for item in items if is_custom(item)}
    custom_pane_items = {style_key(item): item for item in items if item.get('glass_custom_texture') and not is_custom(item)}
    referenced_meshes = {c.U32(instances, i * 112 + 104) for i in range(len(instances) // 112)}
    mesh_slots = [k for k in range(117, -1, -1) if k not in referenced_meshes
                  and not g.meshes[k].has48 and not has_geometry(k)]
    referenced_vbs = {c.U32(s.s16, 8) for m in g.meshes for s in m.subs}
    vb_slots = [k for k in range(117, -1, -1) if k not in referenced_vbs]
    if len(free_sources) < len(items) or len(mesh_slots) < len(styles) or len(vb_slots) < 1 + len(custom_mesh_items):
        raise ValueError(f'Not enough unused native source/render/vertex slots: need {len(items)} instances, {len(styles)} mesh slots, {1+len(custom_mesh_items)} vertex slots; available {len(free_sources)} / {len(mesh_slots)} / {len(vb_slots)}. Reduce map batches or native prop count.')
    vi = vb_slots[0]
    g.vbs[vi] = copy.deepcopy(dg.vbs[90])
    g.auxflag[vi] = dg.auxflag[90]
    custom_vb_slots = iter(vb_slots[1:])
    additions, texture_remap = [], {}
    existing_names = {e.name: e for e in existing}
    def import_texture(index, original_name=False, surface_id=None):
        name = ds[index] if index is not None else 'smoke_normal04.tga'
        cache_key = (name, original_name, surface_id)
        if cache_key in texture_remap:
            return texture_remap[cache_key]
        entry = next((e for e in de if e.name == name), None)
        if entry is None:
            raise ValueError('Prefab texture missing: ' + name)
        suffix = '_'+physical.SUFFIXES[surface_id] if surface_id is not None else ''
        dest_name = name if original_name else f'ng_{map_name}_{index}{suffix}.tga'
        if len(dest_name.encode('ascii')) >= peg.NAME_LEN:
            raise ValueError('Native glass texture name exceeds format capacity.')
        if dest_name in existing_names:
            if existing_names[dest_name].payload != entry.payload:
                raise ValueError('Conflicting glass texture: ' + dest_name)
            idx = strings.index(dest_name)
        else:
            idx = c.add_strings(ch, [dest_name])[0]
            end = min([e.data_offset for e in de if e.data_offset > entry.data_offset] + [len(draw)])
            record = bytearray(entry.raw)
            peg._write_name(record, dest_name)
            additions.append((record, draw[entry.data_offset:end]))
        texture_remap[cache_key] = idx
        return idx
    meshes = {}
    for style, me in zip(styles, mesh_slots):
        # v0.98: A native destructible object's DAMAGE is independent of its
        # render shader. v0.97 always cloned donor material 36 (tinted glass)
        # for imported meshes, causing crates to render transparent/glowing.
        # Use donor 35 (solid/opaque blue pane's render path) unless the user
        # explicitly enabled alpha for that object's original material.
        custom_mesh_opacity = (int(custom_mesh_items[style].get('native_opacity',100))
                               if style in custom_mesh_items else None)
        custom_mesh_alpha = (custom_mesh_opacity < 100 if custom_mesh_opacity is not None else None)
        donor_material_index = (36 if custom_mesh_alpha else 35) if custom_mesh_alpha is not None else (
            MATERIALS[custom_pane_items[style].get('glass_style','tinted')] if style.startswith('custom_') else MATERIALS[style])
        wood_mode = (style in custom_mesh_items and
                     custom_mesh_items[style].get('native_breakable_kind','glass') == WOOD_MODE)
        if wood_mode:
            # Genuine opaque SCENERY shader/resource links, NOT the native
            # GLASS donor render material. Give wooden crates the render path
            # normally used for solid map geometry. This may eliminate the
            # remaining transparent appearance but still needs in-game proof.
            opaque_candidates = [(i, m) for i, m in enumerate(g.mats)
                                 if c.U32(m.m, 0) == bridge.K_BASE_SHADER
                                 and c.U16(m.m, 18) == 3
                                 and c.U16(m.m, 10) >= 1
                                 and len(m.parts[0]) >= 12]
            if not opaque_candidates:
                raise ValueError('No normal opaque material to use for breakable wood.')
            # Prefer an opaque WOOD material if one exists already, then
            # fall back to any stock solid shader. This only clones shader
            # parameters, not the source image or physical ID.
            def wood_priority(pair):
                _, template = pair
                try:
                    text = strings[c.U32(template.parts[0], 4)].lower()
                except (IndexError, ValueError):
                    text = ''
                return 0 if text.endswith('_wo.tga') else 1
            _, template = min(opaque_candidates, key=wood_priority)
            material = copy.deepcopy(template)
            material_source_ents = g.ents
        else:
            material = copy.deepcopy(dg.mats[donor_material_index])
            material_source_ents = dg.ents
        oldkey = c.U32(material.m, 4)
        key = c.crc32_sr(map_name + '/native_glass/' + style)
        if any(c.U32(m.m, 4) == key for m in g.mats):
            raise ValueError('Native glass material key collision.')
        c.Wr32(material.m, 4, key)
        for j in range(c.U16(material.m, 10)):
            original_index=c.U32(material.parts[0], j * 12 + 4)
            if j == 0 and style.startswith(('custom_', 'mesh_')):
                image_path=custom_style_paths[style]
                surface_id = physical.native_surface_id(custom_mesh_items[style]) if style in custom_mesh_items else 8
                target_name=f'ng_{map_name[:7]}_{style[-8:]}_{physical.SUFFIXES[surface_id]}.tga'
                idx=c.add_strings(ch, [target_name])[0]
                # The wood material is cloned from the destination (not the
                # prefab); use the proven prefab DXT1 directory entry to
                # encode its new diffuse texture.
                image_donor_index=(c.U32(dg.mats[35].parts[0],4)
                                   if wood_mode else original_index)
                donor_entry=next(e for e in de if e.name==ds[image_donor_index])
                record=bytearray(donor_entry.raw)
                peg._write_name(record,target_name)
                # Respect opacity consistently in the PEG payload AND in the
                # native render material. A PNG with a fully opaque alpha
                # channel should not make a solid crate use the glass shader.
                use_alpha = False if wood_mode else (custom_mesh_alpha if custom_mesh_alpha is not None else donor_material_index == 36)
                if wood_mode:
                    record,encoded=_encode_solid_texture(donor_entry,image_path,target_name)
                else:
                    record,encoded=_encode_custom_texture(donor_entry,image_path,target_name,use_alpha,custom_mesh_opacity)
                additions.append((record,encoded))
            elif wood_mode:
                # Other native/static shader descriptors already refer to the
                # destination map's own texture table. Preserve these indices.
                idx=original_index
            else:
                idx=import_texture(original_index, surface_id=8 if j == 0 else None)
            c.Wr32(material.parts[0],j * 12 + 4,idx)
        mid = len(g.mats)
        g.mats.append(material)
        for source in list(material_source_ents):
            if c.U32(source.e, 4) == oldkey:
                ent = copy.deepcopy(source)
                c.Wr32(ent.e, 4, key)
                ent.x = bytearray(len(ent.x))
                g.ents.append(ent)
        mesh = copy.deepcopy(dg.meshes[90])
        mesh_vi = vi
        if style in custom_mesh_items:
            item = custom_mesh_items[style]
            mesh_vi = next(custom_vb_slots)
            render = build_custom_render(item['native_mesh_obj'],
                                         float(item['scale']) * float(world_scale), mirror_x, flip_obj_v=flip_obj_v)
            donor_vb = copy.deepcopy(dg.vbs[90])
            c.Wr16(donor_vb.desc, 0, render.tris)
            c.Wr16(donor_vb.desc, 12, render.verts)
            c.Wr16(donor_vb.desc, 14, len(render.ib))
            c.Wr16(donor_vb.desc, 16, 24)
            donor_vb.vd = bytearray(render.vd)
            donor_vb.ib = bytearray()
            for index in render.ib:
                c.Put16(donor_vb.ib, index)
            g.vbs[mesh_vi] = donor_vb
            g.auxflag[mesh_vi] = 0
            for axis in range(3):
                c.WrF(mesh.hdr, 4*axis, render.mn[axis])
                c.WrF(mesh.hdr, 12+4*axis, render.mx[axis])
            sub = mesh.subs[0]
            c.Wr16(sub.s16, 2, 1)
            sub.b16 = bytearray()
            c.Put32(sub.b16, 0)
            c.Put16(sub.b16, len(render.ib))
            c.Put16(sub.b16, mid)
        for s in mesh.subs:
            c.Wr32(s.s16, 8, mesh_vi)
            for j in range(c.U16(s.s16, 2)):
                c.Wr16(s.b16, j * 8 + 6, mid)
        g.meshes[me] = mesh
        ch.get('a164').data[me * 16:(me + 1) * 16] = donor.get('a164').data[90 * 16:91 * 16]
        if c.parse_mopp_blocks(g.coll)[me]['code']:
            raise ValueError('Pane render slot has permanent collision.')
        meshes[style] = me
    import_texture(None, True)  # Name is embedded inside glass_md's WB17 data.
    c.Wr16(g.mathdr, 0, len(g.mats))
    bridge._sort_and_validate_material_resource_links(g)
    ch.get('block556').data = bytearray(donor.get('block556').data)
    ch.get('skip388').data = bytearray(donor.get('skip388').data)
    c.Wr32(ch.header, 204, len(ch.get('skip388').data))
    damage = ch.get('rec_blob308').data
    damage_offset = len(damage) - 4
    damage += b'Glass 3x3\0'
    c.Wr32(damage, 0, len(damage) - 4)
    names = bytes(recs[count * 80:]).split(b'\0')[:count]
    placements = []
    physics_bank=bytearray(ch.get('block556').data)
    map_min = [c.F32(g.vec24, a * 4) for a in range(3)]
    map_max = [c.F32(g.vec24, 12 + a * 4) for a in range(3)]
    tree_min, tree_max = list(map_min), list(map_max)
    # Include all live source bounds, including a preserved optional sky.
    for r in range(count):
        ii = c.I32(recs, r * 80 + 60)
        if 0 <= ii < len(instances) // 112 and has_geometry(c.U32(instances, ii * 112 + 104)):
            for a in range(3):
                tree_min[a] = min(tree_min[a], c.F32(recs, r * 80 + a * 4))
                tree_max[a] = max(tree_max[a], c.F32(recs, r * 80 + 16 + a * 4))
    hashes = {c.U32(recs, i * 80 + 40) for i in range(count)}
    for j, (item, (r, ii)) in enumerate(zip(items, free_sources)):
        me = meshes[style_key(item)]
        record = bytearray(donor.get('static_records').data[8000:8080])
        instance = bytearray(donor.get('instances').data[11200:11312])
        pos, basis = game_transform(item, world_scale, origin, mirror_x)
        for a, value in enumerate(pos):
            c.WrF(instance, 4 + a * 4, value)
        for a, value in enumerate(basis):
            c.WrF(instance, 16 + a * 4, value)
        c.Wr32(instance, 104, me)
        instances[ii * 112:(ii + 1) * 112] = instance
        name = f'{map_name}_native_glass_{j:03d}'
        hash_value = c.crc32_sr(name)
        if hash_value in hashes:
            raise ValueError('Native object name hash collision.')
        hashes.add(hash_value)
        c.Wr32(record, 40, hash_value)
        c.Wr32(record, 60, ii)
        c.Wr32(record, 64, damage_offset)
        assert c.U32(record, 32) == 0x10021400 and c.U16(record, 56) == 26
        collision_selector=26
        if is_custom(item):
            local_min=[c.F32(g.meshes[me].hdr,a*4) for a in range(3)]
            local_max=[c.F32(g.meshes[me].hdr,12+a*4) for a in range(3)]
            physics_bank, collision_selector=_append_native_box_hull(physics_bank,local_min,local_max)
            c.Wr16(record,56,collision_selector)
        assert c.U16(record, 48) == c.U16(record, 50) == 65535
        bounds = c.instance_aabb(instance, 0,
            [c.F32(g.meshes[me].hdr, a * 4) for a in range(3)],
            [c.F32(g.meshes[me].hdr, 12 + a * 4) for a in range(3)])
        for a in range(3):
            c.WrF(record, a * 4, bounds[0][a])
            c.WrF(record, 16 + a * 4, bounds[1][a])
            tree_min[a] = min(tree_min[a], bounds[0][a])
            tree_max[a] = max(tree_max[a], bounds[1][a])
            map_min[a] = min(map_min[a], bounds[0][a])
            map_max[a] = max(map_max[a], bounds[1][a])
        recs[r * 80:(r + 1) * 80] = record
        names[r] = name.encode('ascii')
        placements.append(dict(name=name, source=r, instance=ii, mesh=me,
                               position=list(pos), basis=basis, bounds=bounds,
                               style=item.get('glass_style', 'tinted'),
                               experimental_custom_mesh=is_custom(item),
                               breakable_kind=item.get('native_breakable_kind','glass'),
                               collision_shape=collision_selector,
                               surface_id=physical.native_surface_id(item),
                               collider='EXPERIMENTAL FITTED CONVEX BOX HULL' if is_custom(item) else 'native pane'))
    ch.get('block556').data=physics_bank
    ch.get('static_records').data = bytearray(recs[:count * 80]) + b''.join(n + b'\0' for n in names)
    for section in ('tree236', 'tree192'):
        bridge._stretch_tree_bounds(ch.get(section).data, tree_min, tree_max)
    for a in range(3):
        c.WrF(g.vec24, a * 4, map_min[a])
        c.WrF(g.vec24, 12 + a * 4, map_max[a])
    c.set_geometry(ch, g)
    output = c.write_chunk(ch)
    check = c.read_chunk(output)
    assert c.chunk_geometry(check).coll == c.chunk_geometry(before).coll
    assert check.get('skip388').data == donor.get('skip388').data
    assert check.get('block556').data == physics_bank
    assert check.get('block556').data[:8] == donor.get('block556').data[:8]
    assert check.get('block556').data[16:len(donor.get('block556').data)] == donor.get('block556').data[16:]
    # Stage both final files and validate texture/resource links before commit.
    staged_peg = peg_path.with_name(peg_path.name + '.native.tmp')
    staged_chunk = chunk_path.with_name(chunk_path.name + '.native.tmp')
    try:
        staged_peg.write_bytes(_append_peg(peg_path, additions))
        _, _, final_entries = peg.parse_peg(staged_peg)
        assert c.chunk_strings(check) == [e.name for e in final_entries]
        for a, b in zip(existing, final_entries):
            assert a.payload == b.payload and a.raw[4:] == b.raw[4:]
        for p in placements:
            rec = check.get('static_records').data[p['source'] * 80:(p['source'] + 1) * 80]
            assert c.U32(rec, 60) == p['instance'] and c.U16(rec, 56) == p['collision_shape']
            assert c.U32(check.get('instances').data, p['instance'] * 112 + 104) == p['mesh']
            db = check.get('rec_blob308').data
            start = c.U32(rec, 64) + 4
            assert bytes(db[start:db.index(0, start)]) == b'Glass 3x3'
        staged_chunk.write_bytes(output)
        peg_before = peg_path.read_bytes()
        staged_peg.replace(peg_path)
        try:
            staged_chunk.replace(chunk_path)
        except Exception:
            peg_path.write_bytes(peg_before)
            raise
    finally:
        for p in (staged_peg, staged_chunk):
            if p.exists():
                p.unlink()
    return dict(native_breakables_created=len(items), placements=placements,
                map_bounds=[map_min, map_max],
                fixed_game_dimensions=[WIDTH, HEIGHT],
                effect='glass_md', independent_collision=True,
                permanent_terrain_collision_unchanged=True,
                new_placements_gameplay_verified=False,
                custom_mesh_collision='EXPERIMENTAL DEDICATED 8-VERTEX HULL; NOT YET GAMEPLAY VERIFIED')
