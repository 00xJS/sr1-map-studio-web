#!/usr/bin/env python3
"""IDA-grounded SR1 triangle/material/bitmap-link auditor (BBChunk v85).

Runtime: sub_821276D8 resolves mesh+0x68 as wrapper-array index x 16;
sub_82139810 uses the selected 8-byte batch record's +6 material ID,
first 12-byte material parameter's +4 as global bitmap/string index,
sub_8265BE10 resolves the 20-byte bitmap registry, and sub_8221EED8
reads physical surface at bitmap entry +0x0A (or falls back to 0).

This is a serializer integrity audit, NOT an assertion that the PEG on-disk
entry stores the same physical ID at +0x0A or that all texture names have
correct physical-surface assignments.
"""
import sr_reborn_core as rc
import sr1_physical_materials as physical

SURFACES=(
    'Concrete','Cardboard','Carpet','Ceramic','Dirt','Drywall','Flesh',
    'Foliage','Glass Heavy','Glass Medium','Glass Light','Grass',
    'Gravel','Marble','Metal Fence','Metal Solid','Metal Thin',
    'Plastic','Rubber','Sand','Water','Wood',
)

def audit_material_chain(chunk, peg_names, render_batches):
    """Verify every exported render batch survives BBChunk serialization.

    chunk: parsed sr_reborn_core.Chunk; peg_names: parsed PEG directory names;
    render_batches: exported per-mesh batch descriptors.
    """
    geom=rc.chunk_geometry(chunk)
    strings=rc.chunk_strings(chunk)
    errors=[]; rows=[]
    if strings != list(peg_names):
        errors.append('BBChunk string names differ from PEG entries')
    if rc.U16(geom.mathdr,0)!=len(geom.mats):
        errors.append('material header count does not equal parsed 0x38 records')
    for r in render_batches:
        mesh_id=int(r['mesh']); batch=int(r['batch']); expected=int(r['material_id'])
        row={'mesh':mesh_id,'batch':batch,'obj_material':r['material'],
             'expected_material_slot':expected,'triangle_selector_offset':6}
        if not (0<=mesh_id<len(geom.meshes)):
            errors.append(f'mesh {mesh_id} is outside the mesh table');continue
        mesh=geom.meshes[mesh_id]
        if not mesh.subs:
            errors.append(f'mesh {mesh_id} has no primary group');continue
        group=mesh.subs[0]
        count=rc.U16(group.s16,2)
        if not (0<=batch<count) or (batch+1)*8>len(group.b16):
            errors.append(f'mesh {mesh_id} batch {batch} missing 8-byte selector');continue
        material_slot=rc.U16(group.b16,batch*8+6)
        row['serialized_material_slot']=material_slot
        row['index_start']=rc.U32(group.b16,batch*8)
        row['index_count']=rc.U16(group.b16,batch*8+4)
        if material_slot!=expected:
            errors.append(f'mesh {mesh_id} batch {batch}: expected material {expected}, got {material_slot}')
        if not (0<=material_slot<len(geom.mats)):
            errors.append(f'mesh {mesh_id} batch {batch}: material slot out of range');continue
        material=geom.mats[material_slot]
        descriptor_count=rc.U16(material.m,0x0A)
        descriptor=material.parts[0] if material.parts else bytearray()
        row['descriptor_count']=descriptor_count
        if descriptor_count<1 or len(descriptor)<12:
            errors.append(f'material {material_slot}: no complete first 12-byte descriptor');continue
        idx=rc.I32(descriptor,4)
        row['bitmap_index']=idx
        row['parameter_tag']=f'0x{rc.U32(descriptor,0):08X}'
        row['bitmap_name']=strings[idx] if 0<=idx<len(strings) else None
        if not (0<=idx<len(strings)):
            errors.append(f'material {material_slot}: invalid bitmap index {idx}')
        elif idx>=len(peg_names) or peg_names[idx]!=strings[idx]:
            errors.append(f'material {material_slot}: BBChunk/PEG texture mismatch for index {idx}')
        rows.append(row)
    if errors:raise RuntimeError('SR1 material/bitmap integrity validation failed: '+'; '.join(errors[:12]))
    return {'ida_chain':'mesh+0x68 -> 16-byte wrapper -> 0x28 geometry -> 8-byte batch+6 -> 0x38 material -> 12-byte parameter+4 -> global bitmap registry',
            'material_records':len(geom.mats),'render_batches_checked':len(rows),
            'physical_surface_note':'Physical ID is runtime bitmap-entry +0x0A; not the bitmap index and not an OBJ material ID. Texture surface semantics require validation in-game.',
            'batches':rows}


def audit_collision_material_keys(geometry, collision_meshes, expected_surfaces, texture_items):
    """Validate MOPP shape keys using the game's packed batch/strip encoding.

    In Reborn-style MOPP the upper 16 bits select the 8-byte material batch,
    while the lower 16 bits identify the triangle within its strip.  Treating
    the entire key as an array index would be wrong.  This check validates the
    recovered lookup chain without claiming a runtime physical effect.
    """
    blocks=rc.parse_mopp_blocks(geometry.coll)
    material_to_surface={x['material']:int(expected_surfaces.get(x['material'],0)) for x in texture_items}
    info=[]; total=0
    for mid in collision_meshes:
        mesh=geometry.meshes[int(mid)]
        if not mesh.subs: raise RuntimeError(f'collision mesh {mid} lacks primary geometry')
        group=mesh.subs[0]
        nb=rc.U16(group.s16,2)
        keys=rc.mopp_keys(blocks[int(mid)]['code'])
        if not keys: raise RuntimeError(f'collision mesh {mid} has no MOPP keys')
        occurrences={}
        for key in keys:
            batch=key>>16
            if batch>=nb:
                raise RuntimeError(f'collision mesh {mid}: MOPP key 0x{key:X} references absent material selector {batch}/{nb}')
            selector_off=8*batch
            first=rc.U32(group.b16,selector_off)
            count=rc.U16(group.b16,selector_off+4)
            triangle_index=key&0xFFFF
            if triangle_index<first or triangle_index+2>=first+count:
                raise RuntimeError(f'collision mesh {mid}: key 0x{key:X} has triangle {triangle_index} outside batch {batch} index range {first}..{first+count}')
            slot=rc.U16(group.b16,selector_off+6)
            if slot>=len(geometry.mats): raise RuntimeError(f'collision mesh {mid}: invalid material {slot}')
            desc=geometry.mats[slot].parts[0]
            if len(desc)<12: raise RuntimeError(f'collision mesh {mid}: material {slot} lacks bitmap descriptor')
            bitmap=rc.I32(desc,4)
            if bitmap<0: raise RuntimeError(f'collision mesh {mid}: negative bitmap index on material {slot}')
            occurrences[(batch,slot,bitmap)]=occurrences.get((batch,slot,bitmap),0)+1
        info.append({'mesh':int(mid),'triangles':len(keys),'material_selectors':nb,
                     'selector_bitmap_links':[{'selector':bi,'material_slot':slot,'bitmap_index':bmp,'triangles':num}
                                              for (bi,slot,bmp),num in sorted(occurrences.items())]})
        total+=len(keys)
    return {'collision_meshes':len(info),'collision_triangles_validated':total,
            'key_format':'upper16=material batch; lower16=strip triangle index',
            'runtime_surface_effects_verified':False,'meshes':info}


def audit_runtime_registration_inputs(chunk, peg_entries, texture_items):
    """Validate the actual 0x8212A100 -> 0x8224D018 serialized name path.

    The retail loader reads descriptor+4 as a BBChunk name-table index, then
    resolves the resulting name to a runtime bitmap index. PEG +0x0A is not
    proof of the runtime physical surface byte pair.
    """
    import re, struct
    import sr_reborn_core as rc
    names=rc.chunk_strings(chunk)
    peg_names=[e.name for e in peg_entries]
    if len(names)!=len(set(n.lower() for n in names)):
        raise RuntimeError('duplicate BBChunk names can make runtime lookup ambiguous')
    if len(peg_names)!=len(set(n.lower() for n in peg_names)):
        raise RuntimeError('duplicate PEG names can make runtime lookup ambiguous')
    if names!=peg_names:
        raise RuntimeError('BBChunk name indices do not match PEG registration order')
    mats=rc.chunk_geometry(chunk).mats
    rows=[]
    # All 22 values confirmed from XEX tables 0x82039F50 / 0x82039FA8.
    # Earlier audits used incorrect codes for Foliage/Gravel/Metal/Rubber.
    for item in texture_items:
        mat=item['material']; mid=int(item['material_id'])
        if mid>=len(mats):raise RuntimeError(f'{mat}: missing exported material {mid}')
        material=mats[mid]
        if not material.parts or len(material.parts[0])<12:
            raise RuntimeError(f'{mat}: missing first 12-byte material descriptor')
        desc=material.parts[0]
        idx=rc.U32(desc,4)
        if idx>=len(names):raise RuntimeError(f'{mat}: invalid BBChunk name index {idx}')
        name=names[idx]
        if name!=item['name']:raise RuntimeError(f'{mat}: name index {idx} resolves to {name}, expected {item["name"]}')
        if len(name.encode('ascii'))>=29:raise RuntimeError(f'{mat}: PEG name exceeds 28 characters')
        if not name.lower().endswith('.tga'):
            raise RuntimeError(f'{mat}: expected .tga filename for bitmap registration')
        surface=int(item['surface_id'])
        expected_suffix=physical.suffix_for_id(surface)
        if not name.lower().endswith('_'+expected_suffix+'.tga'):
            raise RuntimeError(f'{mat}: texture name {name} cannot classify as surface {surface}')
        reserved=struct.unpack_from('>H',peg_entries[idx].raw,0x0a)[0]
        if reserved!=0:
            raise RuntimeError(f'{mat}: unexpected nonzero PEG directory +0x0A field {reserved}; retail controls are zero')
        rows.append({'material':mat,'material_slot':mid,'bbchunk_name_index':idx,
                     'filename':name,'requested_surface_id':surface,
                     'requested_surface_name':physical.NAMES[surface],
                     'expected_bitmap_suffix':'_'+expected_suffix,
                     'filename_classified_surface_id':physical.classify_bitmap_name(name),
                     'peg_disk_field_0x0A':reserved,
                     'runtime_bitmap_index':'assigned_by_game',
                     'runtime_surface_id':'requires_game_observation; late PEG attachment may retain Concrete 0'})
    return {'passed':True,'name_table_count':len(names),'checked':len(rows),
            'notes':'Static registration inputs valid; no runtime surface or texture registration claimed.',
            'runtime_breakpoints':{'fallback':'0x8265AF90','bitmap_resolve':'0x8265BA80','descriptor_store':'0x8224D154'},
            'textures':rows}
