#!/usr/bin/env python3
from __future__ import annotations
from pathlib import Path
import json, re, shutil, hashlib, zipfile
from PIL import Image

import beaver_bbchunk
import peg_xbox2_beaver
import sr1_sidecars

HERE=Path(__file__).resolve().parent
DEFAULT_REFERENCE=HERE/'reference_beavercreek'
EXPORTER_VERSION='0.14'


def sanitize_map_name(name):
    s=re.sub(r'[^a-zA-Z0-9_]','_',str(name).strip()).lower()
    if not s: s='halo_map'
    if len(s)>11:
        raise RuntimeError('Map base name must be 11 characters or fewer for the recovered SR1 BBCity name slot. Example: bloodgulch')
    return s


def export_map(obj_path,texture_mapping,output_dir,map_name='halo_map',reference_dir=None,log=None,alpha_mapping=None,world_scale=0.50,sky_texture=None,minimap_texture=None):
    def say(x):
        if log: log(str(x))
        else: print(x)
    map_name=sanitize_map_name(map_name)
    alpha_mapping=dict(alpha_mapping or {})
    obj_path=Path(obj_path)
    sky_texture=str(sky_texture).strip() if sky_texture else ''
    minimap_texture=str(minimap_texture).strip() if minimap_texture else ''
    if sky_texture and not Path(sky_texture).is_file(): raise RuntimeError('skybox image not found: '+sky_texture)
    if minimap_texture and not Path(minimap_texture).is_file(): raise RuntimeError('minimap image not found: '+minimap_texture)
    minimap_resource=f'{map_name}.tga' if minimap_texture else None
    out=Path(output_dir); out.mkdir(parents=True,exist_ok=True)
    ref=Path(reference_dir) if reference_dir else DEFAULT_REFERENCE
    required=['beavercreek.bbchunk_xbox2','beavercreek.peg_xbox2','beavercreek.bbcity_xbox2','beavercreek.pvsv_xbox2']
    for n in required:
        if not (ref/n).is_file(): raise RuntimeError(f'missing reference file: {ref/n}')

    # Choose real Caboose Beaver MATERIAL records. Draw selectors index the
    # material table, and each material record then points at a diffuse PEG
    # resource.  Do not confuse selector/material ID with texture slot.
    material_table=beaver_bbchunk.parse_material_texture_bindings((ref/'beavercreek.bbchunk_xbox2').read_bytes())
    slot_plan,slot_details=peg_xbox2_beaver.plan_fixed_materials(
        ref/'beavercreek.peg_xbox2',texture_mapping,material_table['records'],alpha_mapping)

    # v0.13: build one authoritative material->resource map up front and feed
    # both the BBChunk and PEG from it.  v0.11 could validate directory names
    # while a stale/mixed PEG still carried payloads in older resource slots.
    # This single-source binding plus byte-level payload validation prevents that.
    _,_,reference_peg_entries=peg_xbox2_beaver.parse_peg(ref/'beavercreek.peg_xbox2')
    mt_by_id={int(r['material_id']):r for r in material_table['records']}
    bindings={}
    used_texture_slots=set()
    for mat,mid_raw in slot_plan.items():
        mid=int(mid_raw)
        if mid not in mt_by_id:
            raise RuntimeError(f'planned Beaver material {mid} missing for {mat!r}')
        rec=mt_by_id[mid]
        tid=int(rec['texture_slot'])
        if tid in used_texture_slots:
            raise RuntimeError(f'duplicate Beaver diffuse resource {tid} in material plan')
        used_texture_slots.add(tid)
        e=reference_peg_entries[tid]
        sd=slot_details[mat]
        bindings[mat]={
            'selector':mid,'material_id':mid,'texture_slot':tid,
            'peg_name':e.name,'source_texture':str(texture_mapping[mat]),
            'shader_flags':int(rec.get('shader_flags',0)),
            'material_record_hash':int(rec.get('record_hash',0)),
            'source_size':sd['source_size'],'slot_size':sd['slot_size'],
            'format':int(sd['format']),'frame_size':int(sd['frame_size']),
            'use_alpha':bool(alpha_mapping.get(mat,False))
        }
    say('1/5 Compiling OBJ render geometry + dedicated Havok collision into Beaver-style BBChunk...')
    bb_report_path=out/f'{map_name}_bbchunk_report.json'
    bb_report,obj=beaver_bbchunk.build_bbchunk(
        obj_path,ref/'beavercreek.bbchunk_xbox2',out/f'{map_name}.bbchunk_xbox2',
        texture_mapping,bb_report_path,world_scale=world_scale,slot_plan=slot_plan,
        preserve_sky=True,minimap_name=minimap_resource
    )
    say(f"    scale={bb_report['world_transform']['scale']:.3f}x grid={bb_report['spatial_grid'][0]}x{bb_report['spatial_grid'][1]} max-object-span={bb_report['max_render_object_span']:.2f}")
    o=bb_report.get('orientation',{})
    n=bb_report.get('normal_alignment',{})
    say(f"    face orientation: checked={o.get('faces_checked',0):,} flipped={o.get('faces_flipped',0):,} pre-negative={o.get('pre_negative',0):,}")
    say(f"    Beaver normal/winding check: triangles={n.get('triangles_checked',0):,} inverted={n.get('negative',0):,} mean={n.get('mean_alignment',0.0):.3f}")
    say(f"    collision: {bb_report.get('collision_triangles',0):,}/{bb_report.get('collision_candidates',0):,} non-degenerate faces, full={bool(bb_report.get('collision_full_coverage'))}")
    if not bb_report.get('collision_full_coverage'):
        raise RuntimeError(f"full collision validation failed: {bb_report.get('collision_triangles',0)}/{bb_report.get('collision_candidates',0)} faces")
    say(f"    Caboose sky mesh 118 preserved: {bool(bb_report.get('sky_preserved'))}")

    # Verify the BBChunk builder consumed the exact authoritative binding map.
    binding_errors=[]
    for mat,b in bindings.items():
        got=bb_report['material_mapping'].get(mat)
        if got is None or int(got['material_id'])!=b['material_id'] or int(got['texture_slot'])!=b['texture_slot'] or got['peg_name']!=b['peg_name']:
            binding_errors.append({'material':mat,'expected':b,'bbchunk':got})
    if binding_errors:
        raise RuntimeError('BBChunk diverged from authoritative material binding plan: '+repr(binding_errors[:4]))

    say('2/5 Rebuilding Xbox2 PEG from the SAME material/resource binding plan...')
    repl={}
    for mat,b in bindings.items():
        repl[b['texture_slot']]={
            'source_path':b['source_texture'],'peg_name':b['peg_name'],
            'material':mat,'use_alpha':b['use_alpha']
        }
    # Caboose special resources: material 28 -> sky texture 30; resource 31 is the
    # map-name minimap image. Neither participates in ordinary OBJ material planning.
    if sky_texture:
        repl[30]={'source_path':sky_texture,'peg_name':'bc_sky_baked.tga','material':'__skybox__','use_alpha':False}
    if minimap_texture:
        repl[31]={'source_path':minimap_texture,'peg_name':minimap_resource,'material':'__minimap__','use_alpha':True}
    peg_report=peg_xbox2_beaver.build_fixed_from_reference(
        ref/'beavercreek.peg_xbox2',out/f'{map_name}.peg_xbox2',repl)

    say('3/5 Writing normalized TGA staging textures...')
    tga_dir=out/f'{map_name}_textures_tga'; tga_dir.mkdir(exist_ok=True)
    for mat,b in bindings.items():
        img=Image.open(b['source_texture']).convert('RGBA')
        if not b['use_alpha']:
            img.putalpha(255)
        img.save(tga_dir/b['peg_name'],format='TGA')
    if sky_texture:
        img=Image.open(sky_texture).convert('RGBA'); img.putalpha(255)
        img.save(tga_dir/'bc_sky_baked.tga',format='TGA')
    if minimap_texture:
        img=Image.open(minimap_texture).convert('RGBA')
        img.save(tga_dir/minimap_resource,format='TGA')

    say('4/5 Generating BBCity + HMAP + PVSV + CTS from imported map bounds/spawn surfaces...')
    side=sr1_sidecars.generate_all(ref,out,map_name,obj,bounds=tuple(tuple(x) for x in bb_report['bounds']))

    say('5/5 Cross-validating generated six-file set...')
    _,ph,pe=peg_xbox2_beaver.parse_peg(out/f'{map_name}.peg_xbox2')
    bdata=(out/f'{map_name}.bbchunk_xbox2').read_bytes()
    slots,ranges=beaver_bbchunk.parse_name_slots_and_ranges(bdata)
    if len(slots)!=32 or len(ranges)!=119 or set(r['mesh'] for r in ranges)!=set(range(119)):
        raise RuntimeError(f'generated BBChunk structural validation failed: slots={len(slots)} ranges={len(ranges)} meshes={len(set(r["mesh"] for r in ranges))}')
    vis=beaver_bbchunk.validate_visibility_against_reference(bdata,(ref/'beavercreek.bbchunk_xbox2').read_bytes())
    if vis['local_aabb_mismatches'] or vis['cull_tree_mismatches']:
        raise RuntimeError('generated Beaver visibility validation failed: '+repr(vis))
    # Every texture directory entry retains native dimensions/format/offsets,
    # and the whole PEG stays precisely the same length as Caboose's sample.
    _,rh,re=peg_xbox2_beaver.parse_peg(ref/'beavercreek.peg_xbox2')
    peg_size=(out/f'{map_name}.peg_xbox2').stat().st_size
    ref_peg_size=(ref/'beavercreek.peg_xbox2').stat().st_size
    if peg_size!=ref_peg_size:
        raise RuntimeError(f'PEG shifted native layout: {peg_size} vs {ref_peg_size}')
    for i,(orig,new) in enumerate(zip(re,pe)):
        if (orig.data_offset,orig.frame_size,orig.width,orig.height,orig.fmt) != (new.data_offset,new.frame_size,new.width,new.height,new.fmt):
            raise RuntimeError(f'PEG entry {i} changed native layout')
        expected_name=str(repl[i].get('peg_name',orig.name)) if i in repl else orig.name
        if new.name!=expected_name:
            raise RuntimeError(f'PEG entry {i} unexpected resource name: {new.name!r} != {expected_name!r}')
    payload_validation=peg_xbox2_beaver.validate_fixed_replacements(
        ref/'beavercreek.peg_xbox2',out/f'{map_name}.peg_xbox2',repl)
    expected_payload_slots=sorted(int(x) for x in repl)
    if payload_validation['expected_slots']!=expected_payload_slots:
        raise RuntimeError('PEG payload-slot validation disagrees with authoritative binding plan')
    say('    PEG payload routing verified: '+', '.join(str(x) for x in expected_payload_slots))
    wrong_materials=[]
    bymesh={r['mesh']:r for r in ranges}
    for r in bb_report['render']:
        if r['triangles']<=0: continue
        expected=bb_report['material_mapping'][r['material']]['material_id']
        if bymesh[r['mesh']]['selector']!=expected:
            wrong_materials.append({'mesh':r['mesh'],'material':r['material'],'expected':expected,'got':bymesh[r['mesh']]['selector']})
    if wrong_materials:
        raise RuntimeError('render-material selector binding mismatch: '+repr(wrong_materials[:4]))
    # Validate the layer that v0.10 got wrong: draw selector -> material record
    # -> diffuse texture resource -> PEG entry.  Selector and PEG slot are
    # intentionally different (e.g. Beaver sky selector 28 -> texture 30).
    generated_mt=beaver_bbchunk.parse_material_texture_bindings(bdata)
    mt_by_id={x['material_id']:x for x in generated_mt['records']}
    material_chain_errors=[]
    for mat,m in bindings.items():
        rec=mt_by_id.get(int(m['material_id']))
        if rec is None or int(rec['texture_slot'])!=int(m['texture_slot']):
            material_chain_errors.append({'material':mat,'selector':m['material_id'],'expected_texture_slot':m['texture_slot'],'record':rec})
        elif int(m['texture_slot'])>=len(pe) or pe[int(m['texture_slot'])].name!=m['peg_name']:
            material_chain_errors.append({'material':mat,'selector':m['material_id'],'texture_slot':m['texture_slot'],'expected_name':m['peg_name'],'actual':pe[int(m['texture_slot'])].name if int(m['texture_slot'])<len(pe) else None})
    if material_chain_errors:
        raise RuntimeError('Beaver material indirection validation failed: '+repr(material_chain_errors[:4]))
    mismatches=[]
    for e in pe:
        if e.index<len(slots) and e.name!=slots[e.index]['text']:
            mismatches.append({'index':e.index,'bbchunk':slots[e.index]['text'],'peg':e.name})
    if mismatches:
        raise RuntimeError('BBChunk/PEG texture-name table mismatch: '+repr(mismatches[:5]))
    files={ext:str(out/f'{map_name}.{ext}') for ext in ['bbchunk_xbox2','peg_xbox2','bbcity_xbox2','hmap_xbox2','pvsv_xbox2','cts']}
    for p in files.values():
        if not Path(p).is_file(): raise RuntimeError('missing generated file '+p)
    report={
        'exporter_version':EXPORTER_VERSION,
        'map_name':map_name,'obj':str(obj_path),'reference_dir':str(ref),'world_scale':float(world_scale),
        'files':files,'tga_dir':str(tga_dir),'bbchunk':bb_report,'alpha_mapping':alpha_mapping,
        'skybox':{'enabled':bool(sky_texture),'source':sky_texture or None,'mesh':118,'material':28,'texture_slot':30,'peg_name':'bc_sky_baked.tga'},
        'minimap':{'enabled':bool(minimap_texture),'source':minimap_texture or None,'texture_slot':31,'peg_name':minimap_resource},
        'peg':peg_report,'authoritative_bindings':bindings,'fixed_material_plan':slot_details,
        'material_table':material_table,'sidecars':side,
        'validation':{
            'bbchunk_peg_name_mismatches':mismatches,'bbchunk_draw_ranges':len(ranges),
            'peg_entries':len(pe),'peg_version':ph.version,'peg_platform':ph.platform,
            'beaver_visibility':vis,'wrong_render_materials':wrong_materials,
            'material_chain_errors':material_chain_errors,'fixed_native_peg_layout':True,
            'material_indirection_validated':True,'authoritative_binding_errors':binding_errors,
            'peg_payload_routing':payload_validation
        },
    }
    # Human-readable OBJ material -> SR1 material/resource lookup for debugging.
    binding_lines=['OBJ material -> Beaver material selector -> diffuse PEG resource (v0.13 authoritative map)']
    for mat,b in bindings.items():
        binding_lines.append(f'{mat}: selector/material={b["material_id"]} -> texture_slot={b["texture_slot"]} name={b["peg_name"]} '
                             f'shader_flags={b["shader_flags"]} source={b["source_size"]} native={b["slot_size"]} fmt=0x{b["format"]:04X}')
        members=[x['mesh'] for x in bb_report['render'] if x['material']==mat and x['triangles']>0]
        binding_lines.append('    meshes: '+', '.join(str(x) for x in members))
    bindings_path=out/f'{map_name}_material_bindings.txt'
    bindings_path.write_text('\n'.join(binding_lines)+'\n',encoding='utf-8')
    report_path=out/f'{map_name}_export_report.json'

    def sha256_file(path):
        h=hashlib.sha256()
        with open(path,'rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):
                h.update(chunk)
        return h.hexdigest()

    manifest={
        'exporter_version':EXPORTER_VERSION,'map_name':map_name,
        'material_slots':{m:{'selector':b['material_id'],'texture_slot':b['texture_slot'],'peg_name':b['peg_name']} for m,b in bindings.items()},
        'verified_peg_payload_slots':payload_validation['verified_slots'],
        'files':{Path(path).name:{'sha256':sha256_file(path),'bytes':Path(path).stat().st_size} for path in files.values()}
    }
    build_id=hashlib.sha256((''.join(x['sha256'] for x in manifest['files'].values())).encode('ascii')).hexdigest()[:12]
    manifest['build_id']=build_id
    report['build_id']=build_id
    report['ready_to_install_zip']=str(out/f'{map_name}_READY_TO_INSTALL_v014_{build_id}.zip')
    report_path.write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
    manifest_path=out/f'{map_name}_build_manifest.json'
    manifest_path.write_text(json.dumps(manifest,indent=2),encoding='utf-8')

    ready_zip=Path(report['ready_to_install_zip'])
    with zipfile.ZipFile(ready_zip,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for path in files.values():
            z.write(path,Path(path).name)
        z.write(bindings_path,bindings_path.name)
        z.write(report_path,report_path.name)
        z.write(manifest_path,manifest_path.name)

    say('Export complete: '+', '.join(Path(x).name for x in files.values()))
    say(f'    build={build_id} PEG payload slots verified={payload_validation["verified_slots"]}')
    say('    READY-TO-INSTALL package: '+ready_zip.name)
    return report

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser(description='Halo/OBJ -> Saints Row 1 six-file Beaver-template map compiler')
    ap.add_argument('obj')
    ap.add_argument('textures_json',help='JSON object mapping OBJ material name -> image path')
    ap.add_argument('output_dir')
    ap.add_argument('--name',default='halo_map')
    ap.add_argument('--reference-dir',default=str(DEFAULT_REFERENCE))
    ap.add_argument('--sky',default='')
    ap.add_argument('--minimap',default='')
    a=ap.parse_args()
    tex=json.loads(Path(a.textures_json).read_text(encoding='utf-8'))
    print(json.dumps(export_map(a.obj,tex,a.output_dir,a.name,a.reference_dir,sky_texture=a.sky,minimap_texture=a.minimap),indent=2,default=str))
