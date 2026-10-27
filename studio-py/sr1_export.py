#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
from sr1_native_sky_audit import inspect_bbcity, audit_pair
import json, re, hashlib, zipfile, struct
import math
from PIL import Image

import peg_xbox2_beaver
import sr1_sidecars
import sr_reborn_bridge
import sr_reborn_core
import sr1_breakables
import sr1_lighting
import sr1_native_glass
import sr1_native_props
import sr1_breakable_tools
import sr1_obj_core
import sr1_cts
import sr1_material_audit
import sr1_surface_preload
from sr1_safe_export import safe_export

HERE=Path(__file__).resolve().parent
DEFAULT_REFERENCE=HERE/'reference_beavercreek'
EXPORTER_VERSION='1.15-surface-registration'


def _normalized_asset_stem(path_like):
    """Return canonical native-sky resource basename, preserving underscores."""
    name=Path(path_like).name.lower().strip()
    for suffix in ('.bbchunk_xbox2', '.peg_xbox2'):
        if name.endswith(suffix):
            name=name[:-len(suffix)]
            break
    # Windows can suffix downloaded duplicates as (1), (2), etc.
    return re.sub(r'\(\d+\)$', '', name).strip()


def sanitize_map_name(name):
    s=re.sub(r'[^a-zA-Z0-9_]','_',str(name).strip()).lower()
    if not s:s='halo_map'
    if len(s)>11:
        raise RuntimeError('Map base name must be 11 characters or fewer. Example: bloodgulch')
    return s


def _obj_positions(path):
    points=[]
    with open(path,encoding='utf-8',errors='replace') as f:
        for line in f:
            if line.startswith('v '):
                parts=line.split()
                points.append(tuple(float(x) for x in parts[1:4]))
    return points


def _sha256(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()


@safe_export
def export_map(obj_path,texture_mapping,output_dir,map_name='halo_map',reference_dir=None,log=None,
               alpha_mapping=None,world_scale=0.50,sky_texture=None,minimap_texture=None,
               mirror_x=True,flip_obj_v=True,double_sided=False,sky_scale=0.0,
               breakable_materials=None,breakables_donor=None, markers=None,marker_coordinate_space="scene", cts_template=None, surface_mapping=None,bbcity_donor=None,native_sky_chunk=None,native_sky_peg=None,fixed_origin=None,render_only_scene_indices=None,double_sided_scene_indices=None,render_only_face_indices=None,native_glass=None,lights=None,surface_preload=False):
    """OBJ -> SR1 custom map using the v0.20 Reborn multi-batch backend.

    Unlike v0.16, materials are draw batches inside a small number of render
    meshes rather than consuming one Beaver render slot apiece. This follows
    the Saints Reborn converter source and removes the 115-slot failure seen on
    60-material assets.
    """
    def say(x):
        if log: log(str(x))
        else: print(x)
    map_name=sanitize_map_name(map_name)
    native_glass=list(native_glass or [])
    sr1_native_props.validate(native_glass)
    sr1_native_glass.validate_placements(native_glass,world_scale)
    native_checks=sr1_breakable_tools.check_scene(native_glass,world_scale,sr1_obj_core.parse_obj_attrs)
    if native_checks['errors']:
        raise ValueError('Native object setup:\n'+'\n'.join(native_checks['errors']))
    for warning in native_checks['warnings']:
        say('    Native object warning: '+warning)
    markers=list(markers or [])
    if not any(m.get('type') in ('Shared spawn','Red team spawn','Blue team spawn') for m in markers):
        raise RuntimeError('Place at least one spawn marker before exporting. Automatic random spawns are disabled.')
    alpha_mapping=dict(alpha_mapping or {})
    surface_mapping=dict(surface_mapping or {})
    for material,value in surface_mapping.items():
        if isinstance(value,bool) or not isinstance(value,int) or not 0 <= value <= 21:
            raise ValueError(f'{material}: physical surface ID must be an integer from 0 to 21')
    obj_path=Path(obj_path); out=Path(output_dir); out.mkdir(parents=True,exist_ok=True)
    ref=Path(reference_dir) if reference_dir else DEFAULT_REFERENCE
    lights=sr1_lighting.validate(lights or [])
    sky_texture=str(sky_texture).strip() if sky_texture else ''
    minimap_texture=str(minimap_texture).strip() if minimap_texture else ''
    if sky_texture and not Path(sky_texture).is_file(): raise RuntimeError('skybox image not found: '+sky_texture)
    if minimap_texture and not Path(minimap_texture).is_file(): raise RuntimeError('minimap image not found: '+minimap_texture)
    native_sky_chunk=str(native_sky_chunk).strip() if native_sky_chunk else ''
    native_sky_peg=str(native_sky_peg).strip() if native_sky_peg else ''
    if bool(native_sky_chunk) != bool(native_sky_peg):
        raise RuntimeError('Native sky needs both the original BBChunk and PEG; selecting only one is unsafe.')
    native_sky_name=''
    if native_sky_chunk:
        for candidate in (native_sky_chunk,native_sky_peg):
            if not Path(candidate).is_file(): raise RuntimeError('native sky source not found: '+candidate)
        chunk_name=_normalized_asset_stem(native_sky_chunk)
        peg_name=_normalized_asset_stem(native_sky_peg)
        if not chunk_name or chunk_name!=peg_name:
            raise RuntimeError('Native sky BBChunk and PEG must share the same base name (for example sr_alwayshwyf01 or sr_custom000001).')
        native_sky_name=chunk_name
    bbcity_donor=str(bbcity_donor).strip() if bbcity_donor else None
    if bbcity_donor and not Path(bbcity_donor).is_file(): raise RuntimeError('native BBCity donor not found: '+bbcity_donor)
    preload_sources=None
    if surface_preload:
        if len(map_name)>10:raise ValueError('Map-only surface preload needs a map name of 10 characters or fewer.')
        bbcity_donor,preload_chunk,preload_peg=sr1_surface_preload.resolve_inputs(bbcity_donor,native_sky_chunk,native_sky_peg)
        preload_sources=(preload_chunk,preload_peg)
        # The new map-specific pair replaces the original environment reference.
        native_sky_chunk=native_sky_peg=native_sky_name=''
    minimap_resource=f'{map_name}.tga' if minimap_texture else None
    for n in ('beavercreek.bbchunk_xbox2','beavercreek.peg_xbox2','beavercreek.bbcity_xbox2','beavercreek.pvsv_xbox2'):
        if not (ref/n).is_file(): raise RuntimeError(f'missing reference file: {ref/n}')
    missing=[m for m,p in texture_mapping.items() if not p or not Path(p).is_file()]
    if missing: raise RuntimeError('missing texture assignment(s): '+', '.join(missing))

    say('1/5 Building Saints Reborn-style multi-batch geometry in the Beaver Creek container...')
    bb_report_path=out/f'{map_name}_bbchunk_report.json'
    bb_report,obj=sr_reborn_bridge.build_bbchunk_multibatch(
        obj_path,ref/'beavercreek.bbchunk_xbox2',out/f'{map_name}.bbchunk_xbox2',
        texture_mapping,map_name,alpha_mapping=alpha_mapping,surface_mapping=surface_mapping,world_scale=world_scale,
        minimap_name=minimap_resource,log=say,report_path=bb_report_path,
        mirror_x=mirror_x,flip_obj_v=flip_obj_v,double_sided=double_sided,sky_scale=sky_scale,
        preserve_fake_sky=bool(sky_texture),fixed_origin=fixed_origin,render_only_scene_indices=render_only_scene_indices,double_sided_scene_indices=double_sided_scene_indices,render_only_face_indices=render_only_face_indices)
    materials=list(bb_report['materials'])
    say(f"    render: {bb_report['render_triangles']:,} triangles, {len(materials)} materials, {bb_report['material_batches']} batches in {bb_report['render_meshes_used']} mesh(es)")
    say(f"    scale={bb_report['world_transform']['scale']:.3f}x; mirror_x={bool(mirror_x)}; flip_obj_v={bool(flip_obj_v)}; double_sided={bool(double_sided)}")
    o=bb_report.get('orientation',{}); n=bb_report.get('normal_alignment',{})
    say(f"    normals/winding: checked={o.get('faces_checked',0):,} flipped={o.get('faces_flipped',0):,}; final inverted={n.get('negative',0):,}")
    say(f"    collision: {bb_report['collision_triangles']:,}/{bb_report['collision_expected_triangles']:,} eligible terrain triangles ({bb_report['source_triangles']:,} total front triangles; imported meshes render-only)")
    say('    Fake sky: '+('selected image; donor sky mesh used' if sky_texture else 'NONE; donor sky mesh disabled'))

    say('2/5 Appending dedicated textures to an expandable PEG...')
    special={}
    if sky_texture:
        special[30]={'source_path':sky_texture,'peg_name':'bc_sky_baked.tga','material':'__skybox__','use_alpha':False}
    if minimap_texture:
        special[31]={'source_path':minimap_texture,'peg_name':minimap_resource,'material':'__minimap__','use_alpha':True}
    dynamic_textures=[dict(item,surface_id=surface_mapping.get(item['material'],0)) for item in bb_report['texture_items']]
    peg_report=sr_reborn_bridge.append_dynamic_textures(
        ref/'beavercreek.peg_xbox2',out/f'{map_name}.peg_xbox2',dynamic_textures,special)
    say(f"    PEG resources: {peg_report['old_count']} -> {peg_report['count']} ({len(peg_report['added'])} map textures appended)")
    if peg_report.get('payload_relocated'):
        say(f"    PEG directory expanded; payload start moved 0x{peg_report['original_data_start']:X} -> 0x{peg_report['data_start']:X} and all offsets were rebuilt")

    tga_dir=out/f'{map_name}_textures_tga'; tga_dir.mkdir(exist_ok=True)
    for item in bb_report['texture_items']:
        im,_,_=sr_reborn_bridge.normalized_image(item['source_path'],item['use_alpha'])
        im.save(tga_dir/item['name'],format='TGA')
    if sky_texture:
        im=Image.open(sky_texture).convert('RGBA'); im.putalpha(255); im.save(tga_dir/'bc_sky_baked.tga',format='TGA')
    if minimap_texture:
        Image.open(minimap_texture).convert('RGBA').save(tga_dir/minimap_resource,format='TGA')

    say('3/5 Generating BBCity + HMAP + PVSV + CTS...')
    if bbcity_donor: say('    Native BBCity metadata donor: '+bbcity_donor+' (weather/TOD functionality unverified)')
    # Never generate random respawns. Build an empty CTS skeleton, then write
    # precisely the user-defined markers using the same geometry normalization.
    placed=[]
    for m in markers:
        pos=sr1_cts.convert_xyz(m['position'],float(world_scale),bool(mirror_x),
                                 (fixed_origin if fixed_origin is not None else sr1_cts.compute_normalization_bounds(_obj_positions(obj_path))),
                                 marker_coordinate_space)
        yaw=sr1_cts.convert_yaw(m.get('yaw',0),bool(mirror_x),marker_coordinate_space)
        if m.get('type') in ('Shared spawn','Red team spawn','Blue team spawn'):
            placed.append((pos[0],pos[1],pos[2],yaw))
    side=sr1_sidecars.generate_all(ref,out,map_name,obj,bounds=tuple(tuple(x) for x in bb_report['bounds']),spawn_points=placed,bbcity_donor=bbcity_donor)
    cts_path=out/f'{map_name}.cts'
    template_content=Path(cts_template).read_text(encoding='utf-8-sig') if cts_template else cts_path.read_text(encoding='utf-8-sig')
    origin=(0.,0.,0.) if marker_coordinate_space=='game' else (fixed_origin if fixed_origin is not None else sr1_cts.compute_normalization_bounds(_obj_positions(obj_path)))
    cts_text,cts_report=sr1_cts.build_cts(template_content,markers,map_name,float(world_scale),bool(mirror_x),origin,marker_coordinate_space,replace_respawns=True)
    cts_path.write_text(cts_text,encoding='utf-8',newline='\r\n')
    # The final CTS is written BEFORE hashing and ZIP packaging.
    sr1_cts.validate_spawn_links(cts_text,len(placed))
    say(f'    CTS: {len(placed)} explicitly placed respawn(s); no automatic spawns')


    say('4/5 Re-parsing and validating material batches / PEG / MOPP collision...')
    chunk_path=out/f'{map_name}.bbchunk_xbox2'; peg_path=out/f'{map_name}.peg_xbox2'
    ch=sr_reborn_core.read_chunk(chunk_path.read_bytes()); g=sr_reborn_core.chunk_geometry(ch)
    strings=sr_reborn_core.chunk_strings(ch)
    _,ph,pe=peg_xbox2_beaver.parse_peg(peg_path); peg_names=[e.name for e in pe]
    # The engine resolves names case-insensitively in some resource paths.
    # Check the FINAL table, after native glass/props append their assets too.
    from collections import Counter
    collisions=[name for name,n in Counter(x.casefold() for x in peg_names).items() if n>1]
    if collisions:
        raise RuntimeError('FINAL PEG has duplicate runtime texture names: '+repr(collisions))
    if any(len(n.encode('ascii'))>=peg_xbox2_beaver.NAME_LEN for n in peg_names):
        raise RuntimeError('FINAL PEG contains truncated resource names')
    if strings!=peg_names:
        bad=[]
        for i in range(max(len(strings),len(peg_names))):
            a=strings[i] if i<len(strings) else None; b=peg_names[i] if i<len(peg_names) else None
            if a!=b: bad.append((i,a,b))
        raise RuntimeError('BBChunk texture string table and PEG directory diverged: '+repr(bad[:8]))

    # The PEG directory's +0x0A field is NOT the runtime bitmap physical SID.
    # Do not silently claim an in-game effect from this serialized field.
    peg_errors=[]
    for entry in peg_report['added']:
        actual=struct.unpack_from('>H',pe[entry['index']].raw,0x0A)[0]
        if actual != 0 or pe[entry['index']].name != entry['name']:
            peg_errors.append((entry['material'],actual,entry['name']))
    if peg_errors:
        raise RuntimeError('PEG directory reserved-field/name mismatch: '+repr(peg_errors[:8]))
    say(f"    Physical surface names: {len(peg_report['added'])} suffixes verified; game runtime IDs depend on registration order")
    runtime_inputs=sr1_material_audit.audit_runtime_registration_inputs(
        ch,pe,[dict(item,material_id=bb_report['material_ids'][item['material']],
                    surface_id=surface_mapping.get(item['material'],0))
               for item in bb_report['texture_items']])
    say(f"    Runtime name-resolution inputs: {runtime_inputs['checked']} validated (game registration still unverified)")
    (out/f'{map_name}_runtime_registration_audit.json').write_text(
        json.dumps(runtime_inputs,indent=2)+'\n',encoding='utf-8')
    mat_errors=[]
    for item in bb_report['texture_items']:
        mat=item['material']; mid=int(bb_report['material_ids'][mat]); M=g.mats[mid]
        tex_idx=sr_reborn_core.U32(M.parts[0],4)
        if tex_idx>=len(strings) or strings[tex_idx]!=item['name']:
            mat_errors.append({'material':mat,'material_id':mid,'texture_index':tex_idx,'expected':item['name'],'actual':strings[tex_idx] if tex_idx<len(strings) else None})
    if mat_errors: raise RuntimeError('dynamic material texture-link validation failed: '+repr(mat_errors[:4]))

    batch_errors=[]
    for r in bb_report['render']:
        k=int(r['mesh']); bi=int(r['batch']); want=int(r['material_id'])
        S=g.meshes[k].subs[0]
        if bi>=sr_reborn_core.U16(S.s16,2):
            batch_errors.append({'mesh':k,'batch':bi,'error':'missing'}); continue
        got=sr_reborn_core.U16(S.b16,8*bi+6)
        if got!=want: batch_errors.append({'mesh':k,'batch':bi,'material':r['material'],'expected':want,'got':got})
    if batch_errors: raise RuntimeError('multi-batch draw-selector validation failed: '+repr(batch_errors[:6]))

    # v0.45: audit serialized mesh/batch -> material -> descriptor -> PEG index
    # using the recovered Xbox 360 runtime offsets. Fail before packaging bad maps.
    material_chain=sr1_material_audit.audit_material_chain(ch,peg_names,bb_report['render'])
    say(f"    IDA material chain: {material_chain['render_batches_checked']} batches verified; {material_chain['material_records']} material records")

    blocks=sr_reborn_core.parse_mopp_blocks(g.coll); coll_checked=0
    for k0 in bb_report.get('collision_meshes',[]):
        k=int(k0); tris=sr_reborn_core.mesh_triangles(g,k); keys=sr_reborn_core.mopp_keys(blocks[k]['code'])
        if len(keys)!=len(tris): raise RuntimeError(f'collision validation failed on mesh {k}: {len(keys)} keys != {len(tris)} triangles')
        coll_checked+=len(tris)
    expected_collision=int(bb_report['collision_expected_triangles'])
    if coll_checked!=expected_collision:
        raise RuntimeError(f'collision validation did not cover every eligible terrain triangle: {coll_checked}/{expected_collision}')

    # Verify the actual packed Havok MOPP keys route to a valid 8-byte
    # material selector, not just to geometry.  Previous exporter checks only
    # compared key/triangle counts; they could not detect wrong selectors.
    collision_links=sr1_material_audit.audit_collision_material_keys(g,bb_report.get('collision_meshes',[]),surface_mapping,bb_report['texture_items'])
    if collision_links['collision_triangles_validated']!=expected_collision:
        raise RuntimeError('MOPP/material key coverage does not equal collision-eligible terrain triangle count')
    say(f"    collision material keys: {collision_links['collision_triangles_validated']:,} triangle keys validated against their material batches")
    bb_report['collision_material_keys']=collision_links

    bb_report['material_mapping']={}
    for mat in materials:
        mid=int(bb_report['material_ids'][mat]); item=next(x for x in bb_report['texture_items'] if x['material']==mat)
        bb_report['material_mapping'][mat]={
            'material_id':mid,'texture_slot':strings.index(item['name']),'peg_name':item['name'],
            'source_texture':str(texture_mapping[mat]),'use_alpha':bool(alpha_mapping.get(mat,False)),'surface_id':int(surface_mapping.get(mat,0)),'dynamic_resource':True,
        }
    bb_report_path.write_text(json.dumps(bb_report,indent=2,default=str),encoding='utf-8')

    native_glass_report=sr1_native_glass.transplant(
        out/f'{map_name}.bbchunk_xbox2',out/f'{map_name}.peg_xbox2',native_glass,
        float(world_scale),bb_report['world_transform']['offset_before_scale'],
        bool(mirror_x),map_name,flip_obj_v=bool(flip_obj_v))
    if native_glass:
        say(f"    Native objects: {len(native_glass)} independent bodies; applying selected behavior profiles next")
        # A pane placed at the edge of the base map must remain inside the
        # compact city streaming/play bounds. Preserve full retail donors.
        city_path=out/f'{map_name}.bbcity_xbox2'
        city=bytearray(city_path.read_bytes())
        if len(city)==960:
            lo,hi=native_glass_report['map_bounds']
            old_bounds=struct.unpack_from('>4f',city,0x78)
            new_bounds=(min(old_bounds[0],math.floor(lo[0])-3.),
                        min(old_bounds[1],math.floor(lo[2])-3.),
                        max(old_bounds[2],math.ceil(hi[0])+3.),
                        max(old_bounds[3],math.ceil(hi[2])+3.))
            struct.pack_into('>4f',city,0x78,*new_bounds)
            city_path.write_bytes(city)
    props_report=sr1_native_props.apply_behaviors(
        out/f'{map_name}.bbchunk_xbox2',out/f'{map_name}.peg_xbox2',native_glass,
        native_glass_report['placements'],map_name)
    if props_report['created']:
        say(f"    Native props: {props_report['created']} movable/explosive objects; stock behavior profiles embedded")
        native_glass_report['effect']='per-object stock profile; see native_props'
        for p in props_report['placements']:
            target=next(x for x in native_glass_report['placements'] if x['source']==p['source'])
            target.update(p)
    # Native transplant runs AFTER the first material-chain audit. Recheck the
    # actual final files, including imported glass/prop textures.
    final_chunk=sr_reborn_core.read_chunk((out/f'{map_name}.bbchunk_xbox2').read_bytes())
    final_strings=sr_reborn_core.chunk_strings(final_chunk)
    _,_,final_pe=peg_xbox2_beaver.parse_peg(out/f'{map_name}.peg_xbox2')
    final_names=[entry.name for entry in final_pe]
    if final_strings != final_names:
        raise RuntimeError('FINAL texture directory/string table mismatch after native-object import')
    from collections import Counter
    repeats=[name for name,count in Counter(n.casefold() for n in final_names).items() if count>1]
    if repeats:
        raise RuntimeError('FINAL texture resource name collision after native-object import: '+repr(repeats))
    say(f'    Final texture-name guard: {len(final_names)} unique PEG / BBChunk resources')
    lighting_report=sr1_lighting.apply_to_map(
        out/f'{map_name}.bbchunk_xbox2',lights,float(world_scale),
        bb_report['world_transform']['offset_before_scale'],bool(mirror_x))
    if lights:say(f"    Native point lights: {lighting_report['exported']} embedded; first gameplay test pending")
    preload_report={'enabled':False,'gameplay_verified':False}
    if preload_sources:
        names=[item['name'] for item in bb_report['texture_items']]
        final_geometry=sr_reborn_core.chunk_geometry(final_chunk)
        for placement in native_glass_report['placements']:
            mesh=final_geometry.meshes[placement['mesh']]
            mid=sr_reborn_core.U16(mesh.subs[0].b16,6)
            material=final_geometry.mats[mid]
            name=final_strings[sr_reborn_core.U32(material.parts[0],4)]
            import sr1_physical_materials as physical
            if physical.classify_bitmap_name(name)!=placement['surface_id']:
                raise RuntimeError('Native material surface suffix disagrees with its profile: '+name)
            names.append(name)
        names=list(dict.fromkeys(names))
        stem=sr1_surface_preload.content_resource_name(map_name,*preload_sources,out/f'{map_name}.peg_xbox2',names)
        preload_report=sr1_surface_preload.build_pair(*preload_sources,out/f'{map_name}.peg_xbox2',names,out,stem)
        preload_report['city_reference']=sr1_surface_preload.patch_bbcity_reference(out/f'{map_name}.bbcity_xbox2',stem)
        preload_report.update(enabled=True,packaged=True)
        side['bbcity']['always_loaded_chunk']=stem
        say(f"    Surface preload: {len(names)} texture materials; all {preload_report['donor_total_entries']} environment entries preserved. Copy the two sf_ files with the map.")
    say('5/5 Building synchronized READY-TO-INSTALL package...')
    files={ext:str(out/f'{map_name}.{ext}') for ext in ('bbchunk_xbox2','peg_xbox2','bbcity_xbox2','hmap_xbox2','pvsv_xbox2','cts')}
    if preload_sources:
        files.update(surface_bbchunk=preload_report['bbchunk'],surface_peg=preload_report['peg'])
    for fp in files.values():
        if not Path(fp).is_file(): raise RuntimeError('missing generated file '+fp)
    manifest={'exporter_version':EXPORTER_VERSION,'backend':'reborn_multibatch','map_name':map_name,
              'files':{Path(p).name:{'sha256':_sha256(p),'bytes':Path(p).stat().st_size} for p in files.values()},
              'materials':{m:{'material_id':bb_report['material_ids'][m],
                              'texture':next(x['name'] for x in bb_report['texture_items'] if x['material']==m),
                             'surface_id':int(surface_mapping.get(m,0))} for m in materials}}
    build_id=hashlib.sha256(''.join(v['sha256'] for v in manifest['files'].values()).encode('ascii')).hexdigest()[:12]
    manifest['build_id']=build_id
    report={'lighting':lighting_report,'runtime_registration_audit':runtime_inputs,'material_chain_audit':material_chain,'exporter_version':EXPORTER_VERSION,'backend':'reborn_multibatch','build_id':build_id,
            'map_name':map_name,'obj':str(obj_path),'world_scale':float(world_scale),'mirror_x':bool(mirror_x),'flip_obj_v':bool(flip_obj_v),'double_sided':bool(double_sided),'files':files,'tga_dir':str(tga_dir),
            'bbchunk':bb_report,'peg':peg_report,'sidecars':side,
            'skybox':{'enabled':bool(sky_texture),'source':sky_texture or None,'mesh':118 if sky_texture else None,
                      'material':28 if sky_texture else None,'texture_slot':30 if sky_texture else None,
                      'size':bb_report.get('sky',{}),'native_bbcity_donor':bbcity_donor or str(ref/'beavercreek.bbcity_xbox2')},
            'minimap':{'enabled':bool(minimap_texture),'source':minimap_texture or None,'texture_slot':31,'peg_name':minimap_resource},
            'validation':{'chunk_strings':len(strings),'peg_entries':len(pe),'material_links':len(materials),
                          'material_batches':bb_report['material_batches'],'render_meshes':bb_report['render_meshes_used'],
                          'collision_triangles':coll_checked,'source_triangles':bb_report['source_triangles'],'double_sided':bool(double_sided),'mopp_blocks':len(blocks),'peg_version':ph.version,'peg_platform':ph.platform}}
    # v0.26: honest, non-destructive native-breakables reporting.  The exporter
    # currently replaces render/collision geometry; it DOES NOT import donor
    # glass records or gameplay damage definitions from arbitrary maps.
    # Native sky assets are an independent game streaming unit, not a sky-image
    # replacement. Stage originals outside the install archive until native
    # resource-loading and BBCity reference/rebase logic is verified.
    report['native_sky_resource']={'requested':bool(native_sky_chunk),'packaged':False,
        'warning':'Full retail BBCity donors can reference native sky resources. The selected native sky pair is packaged with the install ZIP when a full retail donor is exported.'}
    report['surface_preload']=preload_report
    if preload_sources:report['native_sky_resource']=dict(preload_report,requested=True)
    if bbcity_donor:
        report['native_bbcity_donor_audit']=inspect_bbcity(bbcity_donor)
        if report['native_bbcity_donor_audit']['format']=='full-retail':
            skyref=preload_report['resource_name'] if preload_sources else report['native_bbcity_donor_audit']['environment_reference']
            say('    BBCity environment reference: %s' % skyref)
            if native_sky_chunk and skyref != native_sky_name:
                say('    WARNING: selected donor references %s, but selected native sky pair is %s' % (skyref,native_sky_name))
    if native_sky_chunk:
        report['native_sky_resource']['original_pair_audit']=audit_pair(native_sky_chunk,native_sky_peg)
        if not all(x['valid_header'] for x in report['native_sky_resource']['original_pair_audit'].values()):
            raise RuntimeError('Native sky resource pair has invalid BBChunk/PEG signatures')
        import shutil
        stage=out/f'{map_name}_native_sky_{native_sky_name or "resource"}'
        stage.mkdir(exist_ok=True)
        entries=[]
        for src in (native_sky_chunk,native_sky_peg):
            dst=stage/Path(src).name
            if Path(src).resolve()!=dst.resolve(): shutil.copy2(src,dst)
            entries.append({'file':dst.name,'bytes':dst.stat().st_size,'sha256':_sha256(dst)})
        report['native_sky_resource'].update({'research_folder':str(stage),'files':entries,'resource_name':native_sky_name})
        (stage/'READ_ME_FIRST.txt').write_text('Native sky resource pair staged unchanged.\n'
            'When a full retail BBCity donor is used, the READY-TO-INSTALL ZIP also includes this pair under its canonical filenames.\n'
            'Place the packaged files in the same levels folder as your exported map files.\n',encoding='utf-8')
        say(f'    Native sky {native_sky_name}: original pair staged and packaged with full retail BBCity exports')
    report['native_glass']=native_glass_report
    report['native_props']=props_report
    report['breakables_audit'] = sr1_breakables.inspect_bbchunk(chunk_path)
    report['breakables_audit']['native_breakables_preserved'] = 'NOT VERIFIED'
    report['breakables_audit']['native_glass_created'] = len(native_glass)
    report['breakables_audit']['warning'] = 'Native glass prefabs are supported; arbitrary OBJ destructibles and planned material targets are not.'
    # Legacy material targets are *audit metadata only*, not native objects.
    # A converted custom breakable is deliberately excluded from the static
    # OBJ, so a saved objNNN_Material target can become stale. Never fail an
    # otherwise-complete native export over that obsolete metadata selection.
    requested_targets=[x.strip() for x in (breakable_materials or []) if x.strip()]
    targets,ignored_targets=sr1_breakables.reconcile_legacy_targets(
        materials,requested_targets,native_breakables=len(native_glass))
    if ignored_targets:
        say('    breakables: ignoring stale OBJ material target(s) (planning metadata only): '
            +', '.join(ignored_targets))
        say('    Native breakable objects and their damage/collision records are unaffected.')
    plan=sr1_breakables.build_breakables_plan(materials,targets,breakables_donor,chunk_path)
    plan['requested_material_targets']=requested_targets
    plan['ignored_unavailable_material_targets']=ignored_targets
    if ignored_targets:
        plan['warnings'].append('Ignored unavailable legacy material targets: '
            +', '.join(ignored_targets)
            +'. Converted native breakables are excluded from the static OBJ and are not controlled by this metadata field.')
    report['breakables_plan']=plan
    plan_path=out/f'{map_name}_breakables_plan.json'
    plan_path.write_text(json.dumps(plan,indent=2,default=str)+'\n',encoding='utf-8')
    geometry_manifest=sr1_breakables.build_breakable_geometry_manifest(
        obj_path,targets,world_scale=world_scale,mirror_x=mirror_x)
    geom_path=out/f'{map_name}_breakables_geometry.json'
    geom_path.write_text(json.dumps(geometry_manifest,indent=2)+'\n',encoding='utf-8')
    report['breakables_geometry']=geometry_manifest
    say(f"    breakables geometry: {geometry_manifest['total_selected_triangles']} selected source triangles (metadata only)")
    say(f'    breakables: {len(targets)} OBJ material targets remain planning-only; {len(native_glass)} native glass prefabs created')
    if plan['warnings']:
        for warning in plan['warnings']: say('    breakables warning: '+warning)
    (out/f'{map_name}_SURFACE_EFFECTS_README.txt').write_text(
        'SaintsReborn TU0: This map uses physical surface suffixes in texture names.\n'
        'If it loads BBChunk first, runtime bitmap placeholders retain Concrete (0) even after PEG attaches.\n'
        'For non-Concrete physical effects install SaintsReborn_Universal_Surface_Repair_TU0 from Map Studio v0.52 in dist/mods.\n'
        'This is an optional, removable Lua mod (not an XEX/EXE patch).\n'
        'Check wml.log for REPAIRED entries and use F8 to inspect collision material IDs.\n',
        encoding='utf-8')
    report_path=out/f'{map_name}_export_report.json'; report_path.write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
    manifest_path=out/f'{map_name}_build_manifest.json'; manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    bindings_path=out/f'{map_name}_material_bindings.txt'
    lines=['OBJ material -> BBChunk material batch -> PEG texture (v0.20 double-sided export)']
    for m in materials:
        mid=bb_report['material_ids'][m]; item=next(x for x in bb_report['texture_items'] if x['material']==m)
        lines.append(f'{m}: material={mid} -> {item["name"]} fmt=0x{(peg_xbox2_beaver.FMT_DXT5 if item.get("use_alpha") else peg_xbox2_beaver.FMT_DXT1):04X} alpha={bool(item.get("use_alpha"))}')
    bindings_path.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    chain_path=out/f'{map_name}_material_chain_audit.json'
    chain_path.write_text(json.dumps(material_chain,indent=2)+'\n',encoding='utf-8')

    is_dust_style = str(side['bbcity'].get('format','')).startswith('full-retail')
    # Place the selected sky resources directly alongside the six map outputs.
    if is_dust_style and native_sky_chunk and native_sky_peg:
        import shutil
        for source,filename in ((native_sky_chunk,f'{native_sky_name}.bbchunk_xbox2'),
                                (native_sky_peg,f'{native_sky_name}.peg_xbox2')):
            target=out/filename
            if Path(source).resolve()!=target.resolve(): shutil.copy2(source,target)
    # v0.62: only six map files plus the selected native-sky pair.
    for old_zip in out.glob(f'{map_name}_READY_TO_INSTALL_*.zip'):
        old_zip.unlink()
    # Reports, generated textures and staging are intermediate build artifacts.
    import shutil
    for auxiliary in (report_path,manifest_path,bindings_path,chain_path,plan_path,geom_path,
                      bb_report_path,out/f'{map_name}_SURFACE_EFFECTS_README.txt'):
        if auxiliary.is_file(): auxiliary.unlink()
    for generated_dir in (tga_dir,out/f'{map_name}_native_sky_{native_sky_name or "resource"}'):
        if generated_dir.is_dir(): shutil.rmtree(generated_dir)
    say('    verified: BBChunk texture strings == PEG names')
    say(f"    verified: {len(materials)} materials across {bb_report['material_batches']} draw batches in only {bb_report['render_meshes_used']} render mesh(es)")
    say(f'    verified: {coll_checked:,}/{bb_report["source_triangles"]:,} source triangles have Reborn MOPP collision; reversed render copies have collision disabled')
    say('Export complete — map and native sky resources saved directly to: '+str(out))
    return report


if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description='Halo/OBJ -> Saints Row 1 custom map compiler (v0.20 double-sided export)')
    ap.add_argument('obj'); ap.add_argument('textures_json'); ap.add_argument('output_dir'); ap.add_argument('--name',default='halo_map')
    ap.add_argument('--reference-dir',default=str(DEFAULT_REFERENCE)); ap.add_argument('--sky',default=''); ap.add_argument('--minimap',default=''); ap.add_argument('--scale',type=float,default=.50)
    ap.add_argument('--surface-preload',action='store_true',help='Register physical textures early using two map-specific environment files (experimental)')
    a=ap.parse_args(); tex=json.loads(Path(a.textures_json).read_text(encoding='utf-8'))
    print(json.dumps(export_map(a.obj,tex,a.output_dir,a.name,a.reference_dir,world_scale=a.scale,sky_texture=a.sky,minimap_texture=a.minimap,surface_preload=a.surface_preload),indent=2,default=str))
