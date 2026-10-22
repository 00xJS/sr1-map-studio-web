"""Extract render geometry from a supported SR1/Xbox2 BBChunk to Wavefront OBJ.

Recovers retail mesh positions and instance transforms from common 12-, 16-, 20-, 24-, 28-, 32- and 36-byte vertices. UVs are
only decoded for the known 24-byte vertex layout; other UV layouts remain unknown.
"""
from pathlib import Path
import struct, json, re, io
from collections import defaultdict
import peg_xbox2_beaver as peg
from PIL import Image
import sr_reborn_core as rc


def _safe_stem(name):
    return re.sub(r'[^A-Za-z0-9_.-]+', '_', Path(name).stem)[:90] or 'texture'


def _dds_from_peg(entry):
    if entry.fmt not in (peg.FMT_DXT1, peg.FMT_DXT3, peg.FMT_DXT5):
        raise ValueError('unsupported format 0x%04X' % entry.fmt)
    kind={peg.FMT_DXT1:'DXT1',peg.FMT_DXT3:'DXT3',peg.FMT_DXT5:'DXT5'}[entry.fmt]
    raw=peg.untile_x360(peg.swap16(entry.payload), entry.width, entry.height,kind)
    # Standard legacy DDS header, readable with Pillow's DDS decoder.
    block=8 if kind=='DXT1' else 16
    linear=max(1,(entry.width+3)//4)*max(1,(entry.height+3)//4)*block
    h=bytearray(128); h[:4]=b'DDS '
    struct.pack_into('<I',h,4,124)
    struct.pack_into('<I',h,8,0x00081007)
    struct.pack_into('<I',h,12,entry.height);struct.pack_into('<I',h,16,entry.width)
    struct.pack_into('<I',h,20,linear);struct.pack_into('<I',h,28,1)
    struct.pack_into('<I',h,76,32);struct.pack_into('<I',h,80,4)
    h[84:88]=kind.encode('ascii')
    struct.pack_into('<I',h,108,0x1000)
    return bytes(h)+raw


def _material_names(ch,g):
    strings=rc.chunk_strings(ch)
    # Material descriptor +0x04 stores an index into BBChunk strings.
    # Recover the diffuse candidate without assuming every retail shader is equivalent.
    found={}; details=[]
    for idx,material in enumerate(g.mats):
        entries=[]
        if material.parts and material.parts[0]:
            count=min(rc.U16(material.m,0x0A),len(material.parts[0])//12)
            for j in range(count):
                at=j*12; ix=rc.U32(material.parts[0],at+4)
                tag=rc.U32(material.parts[0],at)
                if ix<len(strings):
                    val=strings[ix]
                    entries.append({'tag':'0x%08X'%tag,'string_index':ix,'resource':val})
        textures=[v['resource'] for v in entries if v['resource'].lower().endswith(('.tga','.tgn','.png','.dds'))]
        found[idx]=textures[0] if textures else None
        details.append({'material_index':idx,'key':'0x%08X'%rc.U32(material.m,4),'textures':textures,'parameters':entries})
    return found,details


def _extract_peg_textures(peg_path,dir_path,referenced):
    _,hdr,entries=peg.parse_peg(peg_path)
    lut={e.name.lower():e for e in entries if e.name}
    result={}; failures=[]
    dir_path.mkdir(parents=True,exist_ok=True)
    for name in sorted(referenced):
        e=lut.get(name.lower())
        if e is None:
            failures.append('Not in PEG: '+name);continue
        filename=_safe_stem(name)+'.png'
        try:
            img=Image.open(io.BytesIO(_dds_from_peg(e)))
            img.load()
            # Preserve aspect ratio while raising the longest edge to 1024.
            # The DDS decoder may return RGB or RGBA; resizing retains alpha.
            max_edge=max(img.size)
            if 0 < max_edge < 1024:
                scale=1024.0/max_edge
                out_size=(max(1,int(round(img.width*scale))),
                          max(1,int(round(img.height*scale))))
                img=img.resize(out_size,Image.Resampling.LANCZOS)
            img.save(dir_path/filename)
            result[name.lower()]='textures/'+filename
        except Exception as ex:
            failures.append('Cannot decode %s (fmt=0x%X): %s'%(name,e.fmt,ex))
    return result,failures




def _export_static_object_inventory(ch, destination):
    """Export BBChunk named static-object records and non-geometry location markers.

    Unlike the placed mesh table, these records identify separate object resources.
    The 6 floats at +0x00,+0x10 appear to be spatial bounds, NOT object
    origin/rotation. Do not fabricate geometry from them.
    """
    import math
    b=ch.get('static_records').data
    count=rc.U32(ch.header,868)
    if len(b)<count*80:
        raise ValueError('static object records truncated')
    names=bytes(b[count*80:]).split(b'\0')
    objects=[]
    for i in range(count):
        a=i*80
        name=names[i].decode('utf-8','replace') if i<len(names) else '<missing-name-%d>'%i
        mn=[rc.F32(b,a+4*j) for j in (0,1,2)]
        mx=[rc.F32(b,a+4*j) for j in (4,5,6)]
        valid=all(math.isfinite(t) and abs(t)<1e7 for t in mn+mx)
        bounds={'first':mn,'second':mx} if valid else None
        center=[(mn[j]+mx[j])*0.5 for j in range(3)] if valid else None
        objects.append({'index':i,'resource_name':name,'bounds_candidates':bounds,'center_marker':center,
                        'record_hex':bytes(b[a:a+80]).hex()})
    json_path=destination.with_name(destination.stem+'_static_objects.json')
    json_path.write_text(json.dumps({'source':str(destination),'count':count,
          'note':'These objects are named references. OBJ cannot extract their actual geometry without locating the linked render models in other game asset files. Coordinates are candidate bounds, not verified placements.',
          'objects':objects},indent=2),encoding='utf-8')
    # A point cloud can be inspected in Blender by importing OBJ vertices.
    # No triangle faces are written, to avoid pretending placeholder boxes are real meshes.
    pts=destination.with_name(destination.stem+'_static_markers.obj')
    with pts.open('w',encoding='utf-8') as f:
        f.write('# POINT MARKERS ONLY — NOT recovered static mesh geometry\n')
        for obj in objects:
            p=obj['center_marker']
            if p:
                f.write('o static_%04d_%s\n'%(obj['index'],_safe_stem(obj['resource_name'])))
                f.write('v %.9g %.9g %.9g\n'%tuple(p))
    return {'count':count,'barrier_count':sum('concretebarrier' in x['resource_name'].lower() for x in objects),
            'inventory':str(json_path),'markers_obj':str(pts)}



def _export_secondary_geometry(ch, geo, destination):
    """Recover readable portions of secondary index batches without inventing indices.

    Secondary data is diagnostic; never merge automatically with primary meshes.
    Clipping is done only when the explicit start is inside the index buffer;
    all incomplete batches are labeled and counted in the report.
    """
    from collections import Counter
    import math
    instances=ch.get('instances').data
    path=destination.with_name(destination.stem+'_secondary_batches.obj')
    stats=Counter()
    sample_failures=[]
    with path.open('w',encoding='utf-8',newline='\n') as out:
        out.write('# SECONDARY GEOMETRY: independent diagnostic extraction.\n')
        out.write('# Incomplete batches may still have gaps; no indices are invented.\n')
        base=1
        for ii in range(len(instances)//112):
            at=112*ii; mi=rc.U32(instances,at+104)
            if mi>=len(geo.meshes):continue
            pos=[rc.F32(instances,at+4+4*j) for j in range(3)]
            rot=[rc.F32(instances,at+16+4*j) for j in range(9)]
            if not all(math.isfinite(v) for v in pos+rot):continue
            for si,sub in enumerate(geo.meshes[mi].subs):
                if not sub.b12:continue
                stats['secondary_placed_submeshes']+=1
                vi=rc.U32(sub.s16,8)
                if vi>=len(geo.vbs):stats['invalid_vb']+=1;continue
                vb=geo.vbs[vi];st=rc.U16(vb.desc,16);cnt=rc.U16(vb.desc,12)
                if st<12 or st>128 or st%4 or not cnt or len(vb.vd)<cnt*st:
                    stats['unsupported_vertices']+=1;continue
                verts=[struct.unpack_from('>fff',vb.vd,k*st) for k in range(cnt)]
                if not all(math.isfinite(v) for xyz in verts for v in xyz):
                    stats['invalid_positions']+=1;continue
                ids=[rc.U16(vb.ib,k) for k in range(0,len(vb.ib)-1,2)]
                faces=[]
                for bi in range(len(sub.b12)//8):
                    first=rc.U32(sub.b12,8*bi);num=rc.U16(sub.b12,8*bi+4)
                    stats['batch_records_seen']+=1
                    if first>=len(ids):
                        stats['unresolved_out_of_bounds_start']+=1
                        if len(sample_failures)<30:sample_failures.append({'instance':ii,'mesh':mi,'submesh':si,'start':first,'requested':num,'available':len(ids),'reason':'start outside buffer'})
                        continue
                    end=min(len(ids),first+num)
                    if end<first+num:
                        stats['truncated_index_ranges']+=1
                        if len(sample_failures)<30:sample_failures.append({'instance':ii,'mesh':mi,'submesh':si,'start':first,'requested':num,'available':len(ids),'reason':'range truncated at buffer end'})
                    if end-first<3:continue
                    strip=ids[first:end]
                    parity=0
                    for t in range(len(strip)-2):
                        a,bb,c=strip[t:t+3]
                        if a==0xffff or bb==0xffff or c==0xffff:
                            parity=0;continue
                        if len({a,bb,c})!=3:
                            parity+=1;continue
                        if max(a,bb,c)>=cnt:
                            stats['triangles_invalid_vertex_index']+=1
                            parity+=1;continue
                        if parity&1:a,bb=bb,a
                        faces.append((a,bb,c));parity+=1
                if not faces:continue
                out.write('o secondary_instance_%04d_a4_%04d_sub_%02d\n'%(ii,mi,si))
                for v in verts:
                    w=[pos[j]+sum(v[k]*rot[3*k+j] for k in range(3)) for j in range(3)]
                    out.write('v %.9g %.9g %.9g\n'%tuple(w))
                for a,b,c in faces:out.write('f %d %d %d\n'%(base+a,base+b,base+c))
                base+=cnt;stats['secondary_faces']+=len(faces);stats['secondary_groups']+=1
    if not stats['secondary_faces']:
        path.unlink(missing_ok=True)
        return dict(stats, path=None, unresolved_samples=sample_failures)
    return dict(stats,path=str(path),unresolved_samples=sample_failures)


def _merge_secondary_into_main(main_path, secondary_path, vertex_offset):
    """Append secondary OBJ geometry with globally rebased vertex references.

    Both source files contain positive 1-based OBJ vertex indices.  The primary
    OBJ can also contain UVs, so keep all its lines intact and leave the
    secondary's vertex-only faces without invented UV coordinates.
    """
    if not secondary_path or not Path(secondary_path).is_file():
        return {'merged': False, 'vertices': 0, 'faces': 0}
    secondary_path = Path(secondary_path)
    verts = faces = 0
    with main_path.open('a', encoding='utf-8', newline='\n') as dest, secondary_path.open('r', encoding='utf-8') as src:
        dest.write('\n# Secondary BBChunk geometry (recovered index batches)\n')
        dest.write('usemtl bb_secondary_geometry\n')
        for line in src:
            if line.startswith('v '):
                verts += 1
                dest.write(line)
            elif line.startswith('f '):
                parts = line.strip().split()
                indices = []
                for p in parts[1:]:
                    if not p.isdecimal():
                        raise ValueError('Unexpected secondary OBJ face index %r' % p)
                    idx = int(p)
                    if idx < 1:
                        raise ValueError('Nonpositive secondary OBJ index')
                    indices.append(str(idx + vertex_offset))
                dest.write('f ' + ' '.join(indices) + '\n')
                faces += 1
            elif line.startswith(('o ', 'g ', '#')):
                dest.write(line)
    secondary_path.unlink()
    return {'merged': True, 'vertices': verts, 'faces': faces}


def export_bbchunk_obj(source, destination, include_all=False, peg_path=None):
    source=Path(source); destination=Path(destination)
    if not source.is_file(): raise FileNotFoundError(source)
    raw=source.read_bytes()
    ch=rc.read_chunk(raw)
    geo=rc.chunk_geometry(ch)
    destination.parent.mkdir(parents=True,exist_ok=True)
    names,material_details=_material_names(ch,geo)
    referenced={v for v in names.values() if v}
    linked={}; extraction_warnings=[]
    if peg_path:
        linked,extraction_warnings=_extract_peg_textures(Path(peg_path),destination.parent/'textures',referenced)
    mtl=destination.with_suffix('.mtl')
    total_faces=0; used_meshes=0; skipped=0; warnings=[]; global_vertex=0; used_materials=set(); extracted_strides=defaultdict(int)
    # Retail map mesh definitions are shared by many placed instances. Their
    # 112-byte instance records contain position, rotation and source mesh ID.
    instances=ch.get('instances').data
    instance_count=len(instances)//112
    used_instances=0
    referenced_mesh_indices={rc.U32(instances,112*i+104) for i in range(instance_count)}
    orphan_mesh_indices=[i for i,m in enumerate(geo.meshes) if i not in referenced_mesh_indices and m.subs]
    orphan_triangles=0
    orphan_groups=0
    orphan_path=destination.with_name(destination.stem+'_unplaced_meshes.obj')
    # These mesh definitions have no known world transform; never silently
    # merge them into the placed map or they will cluster at the origin.
    with orphan_path.open('w',encoding='utf-8',newline='\n') as orphan:
        orphan.write('# UNPLACED retail mesh definitions; coordinates are local.\n# Do not merge into map without identifying placement transforms.\n')
        orphan_vertex=0
        for mi in orphan_mesh_indices:
            for si,sub in enumerate(geo.meshes[mi].subs):
                if len(sub.s16)<12 or not rc.U16(sub.s16,2):continue
                vi=rc.U32(sub.s16,8)
                if vi>=len(geo.vbs):continue
                vb=geo.vbs[vi]
                stride=rc.U16(vb.desc,16); count=rc.U16(vb.desc,12)
                if stride<12 or stride>128 or stride%4 or not count or len(vb.vd)<stride*count:continue
                import math
                vertices=[struct.unpack_from('>fff',vb.vd,j*stride) for j in range(count)]
                if not all(all(math.isfinite(v) for v in xyz) for xyz in vertices):continue
                inds=[rc.U16(vb.ib,j) for j in range(0,len(vb.ib)-1,2)]
                faces=[]
                for bi in range(rc.U16(sub.s16,2)):
                    at=bi*8
                    if at+8>len(sub.b16):break
                    first=rc.U32(sub.b16,at);num=rc.U16(sub.b16,at+4)
                    if first+num>len(inds):continue
                    for j in range(num-2):
                        a,b,c=inds[first+j:first+j+3]
                        if len({a,b,c})!=3 or max(a,b,c)>=count:continue
                        if j&1:a,b=b,a
                        faces.append((a,b,c))
                if not faces:continue
                orphan.write('o unplaced_mesh_%04d_sub_%02d\n'%(mi,si))
                for xyz in vertices:orphan.write('v %.9g %.9g %.9g\n'%xyz)
                for a,b,c in faces:orphan.write('f %d %d %d\n'%(orphan_vertex+a+1,orphan_vertex+b+1,orphan_vertex+c+1))
                orphan_vertex+=count;orphan_triangles+=len(faces);orphan_groups+=1
    if not orphan_groups:orphan_path.unlink(missing_ok=True)
    with destination.open('w',encoding='utf-8',newline='\n') as out, mtl.open('w',encoding='utf-8',newline='\n') as matout:
        out.write('# SR1 BBChunk render geometry extraction\n# Source: '+source.name+'\nmtllib '+mtl.name+'\n')
        for ii in range(instance_count):
            ia=112*ii
            mi=rc.U32(instances,ia+104)
            if mi>=len(geo.meshes):
                warnings.append('Instance %d references invalid mesh %d'%(ii,mi));skipped+=1;continue
            mesh=geo.meshes[mi]
            if not mesh.subs: continue
            position=[rc.F32(instances,ia+4+4*j) for j in range(3)]
            rotation=[rc.F32(instances,ia+16+4*j) for j in range(9)]
            # Retail matrices are column-major; matches rc.instance_aabb.
            if not all(__import__('math').isfinite(x) for x in position+rotation):
                warnings.append('Instance %d has nonfinite transform'%ii);skipped+=1;continue
            used_instances+=1
            for si,sub in enumerate(mesh.subs):
                try:
                    if len(sub.s16)<12 or rc.U16(sub.s16,2)==0: continue
                    vb_i=rc.U32(sub.s16,8)
                    if vb_i>=len(geo.vbs): skipped+=1;continue
                    vb=geo.vbs[vb_i]
                    stride=rc.U16(vb.desc,16)
                    count=rc.U16(vb.desc,12)
                    if stride<12 or count==0 or len(vb.vd)<count*stride: skipped+=1;continue
                    if stride < 12 or stride > 128 or stride % 4:
                        warnings.append('Skipped mesh %d submesh %d: unsupported vertex stride %d'%(mi,si,stride));skipped+=1;continue
                    inds=[rc.U16(vb.ib,i) for i in range(0,len(vb.ib)-1,2)]
                    start=global_vertex+1
                    group='instance_%03d_mesh_%03d_sub_%02d'%(ii,mi,si)
                    out.write('o '+group+'\n')
                    for n in range(count):
                        x,y,z=struct.unpack_from('>fff',vb.vd,n*stride)
                        local=(x,y,z)
                        if not all(__import__('math').isfinite(c) for c in local):
                            raise ValueError('nonfinite position in mesh %d, vertex %d'%(mi,n))
                        world=[position[j]+sum(local[k]*rotation[3*k+j] for k in range(3)) for j in range(3)]
                        out.write('v %.9g %.9g %.9g\n'%tuple(world))
                    if stride==24:
                        for n in range(count):
                            u,v=struct.unpack_from('>hh',vb.vd,n*stride+20)
                            out.write('vt %.9g %.9g\n'%(u/1024.0,v/1024.0))
                    emitted=0
                    for bi in range(rc.U16(sub.s16,2)):
                        at=bi*8
                        if at+8>len(sub.b16): skipped+=1;break
                        first=rc.U32(sub.b16,at); num=rc.U16(sub.b16,at+4)
                        matid=rc.U16(sub.b16,at+6)
                        material='bb_material_%04d'%matid
                        if first+num>len(inds): skipped+=1;continue
                        if matid not in used_materials:
                            used_materials.add(matid)
                            resource=names.get(matid)
                            matout.write('newmtl '+material+'\nKd 0.8 0.8 0.8\n')
                            if resource and resource.lower() in linked:
                                matout.write('map_Kd '+linked[resource.lower()]+'\n')
                            elif resource:
                                matout.write('# Native texture reference: '+resource+'\n')
                            matout.write('\n')
                        out.write('usemtl '+material+'\n')
                        for k in range(num-2):
                            a,b,c=inds[first+k:first+k+3]
                            if len({a,b,c})<3 or max(a,b,c)>=count:continue
                            if k&1:a,b=b,a
                            a+=start;b+=start;c+=start
                            if stride==24: out.write('f %d/%d %d/%d %d/%d\n'%(a,a,b,b,c,c))
                            else:out.write('f %d %d %d\n'%(a,b,c))
                            emitted+=1
                    if emitted: used_meshes+=1;total_faces+=emitted;extracted_strides[stride]+=1
                    global_vertex+=count
                except (IndexError,ValueError,struct.error,RuntimeError) as exc:
                    warnings.append('Skipped mesh %d submesh %d: %s'%(mi,si,exc));skipped+=1
    warnings.extend(extraction_warnings)
    report={'native_materials':material_details,'used_material_count':len(used_materials),'resolved_texture_references':{str(k):names.get(k) for k in sorted(used_materials)},'decoded_textures':len(linked),'peg':str(peg_path) if peg_path else None,'source':str(source),'obj':str(destination),'mtl':str(mtl),'meshes':used_meshes,'instances_total':instance_count,'instances_exported':used_instances,'vertex_stride_groups':dict(extracted_strides),'faces':total_faces,'vertices':global_vertex,'skipped':skipped,'orphan_mesh_definitions':len(orphan_mesh_indices),'orphan_mesh_ids':orphan_mesh_indices,'unplaced_obj':str(orphan_path) if orphan_groups else None,'unplaced_triangles':orphan_triangles,'unplaced_groups':orphan_groups,'warnings':warnings[:100], 'note':'All placed retail instances exported using their position and 3x3 column-major transform. Position decoding accepts aligned 12-128-byte layouts with finite positions; UVs only decoded for known 24-byte layout. Native shaders and skeletal geometry are not reconstructed.'}
    secondary_report = _export_secondary_geometry(ch,geo,destination)
    secondary_path = secondary_report.get('path')
    with mtl.open('a',encoding='utf-8',newline='\n') as matout:
        matout.write('newmtl bb_secondary_geometry\nKd 0.8 0.8 0.8\n\n')
    merge = _merge_secondary_into_main(destination, secondary_path, global_vertex)
    if merge['merged']:
        assert merge['faces'] == secondary_report.get('secondary_faces', 0), 'Secondary face count changed during merge'
    secondary_report['path'] = None
    secondary_report['merged_into_primary_obj'] = bool(merge['merged'])
    report['secondary_geometry_audit'] = secondary_report
    report['primary_faces'] = total_faces
    report['secondary_faces'] = merge['faces']
    report['faces'] = total_faces + merge['faces']
    report['primary_vertices'] = global_vertex
    report['secondary_vertices'] = merge['vertices']
    report['vertices'] = global_vertex + merge['vertices']
    report['note'] += ' Secondary recovered batches are appended to the same OBJ with rebased vertex indices; incomplete index ranges remain incomplete.'
    static_report = _export_static_object_inventory(ch,destination)
    report['static_objects'] = static_report
    if static_report['count']:
        report['warnings'].append('%d named static objects are references, not embedded mesh geometry; see static_objects.json' % static_report['count'])
    destination.with_suffix('.obj_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    if not total_faces: raise RuntimeError('No supported render triangles extracted. See '+str(destination.with_suffix('.obj_report.json')))
    return report

if __name__=='__main__':
    import argparse
    p=argparse.ArgumentParser();p.add_argument('bbchunk');p.add_argument('obj');p.add_argument('--peg');args=p.parse_args()
    print(json.dumps(export_bbchunk_obj(args.bbchunk,args.obj,peg_path=args.peg),indent=2))
