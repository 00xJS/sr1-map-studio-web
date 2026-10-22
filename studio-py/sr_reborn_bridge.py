#!/usr/bin/env python3
"""Bridge the existing easy OBJ/Halo workflow to the recovered Saints Reborn core.

v0.16 keeps Caboose's proven Beaver Creek template (including sky/minimap), but
uses format behavior recovered from the Saints Reborn Map Converter source:
  * grow the BBChunk string/material tables instead of borrowing fixed material slots
  * append named PEG resources instead of overwriting unrelated donor slots
  * rebuild Havok MOPP collision from every active render triangle

This removes the old fixed-material/three-collision-mesh limitations without
requiring Blender or SaintsRebornMapConverter.exe.
"""
from __future__ import annotations
from pathlib import Path
import copy, math, struct, json, re
from PIL import Image

import sr_reborn_core as rc
import peg_xbox2_beaver as peg
import sr1_physical_materials as physical

K_BASE_SHADER=0x100742AD


def _pow2_nearest(n:int)->int:
    # Streaming-memory compatibility: Flatgrass PEG used multiple 2048px
    # DXT textures (2 MiB EACH), while known-working Hit & Run has far
    # smaller resident textures. Cap new map textures; never alter donor.
    n=max(4,min(1024,int(n)))
    # A 1024px cap must not silently DOWNsample 513..1023px to 512.
    # Round upward to the next supported power of two, respecting the cap.
    return min(1024,1 << (n-1).bit_length())


def normalized_image(path,use_alpha=False):
    im=Image.open(path).convert('RGBA')
    sw,sh=im.size
    w,h=_pow2_nearest(sw),_pow2_nearest(sh)
    if (w,h)!=(sw,sh): im=im.resize((w,h),Image.Resampling.LANCZOS)
    if not use_alpha: im.putalpha(255)
    return im,(sw,sh),(w,h)


def _encoded_payload(im,fmt):
    linear,kind=peg.compress_image_for_format(im,fmt)
    tiled=peg.tile_x360(linear,im.width,im.height,kind)
    return peg.swap16(tiled),kind


def append_dynamic_textures(reference_peg,output_peg,items,replace_special=None):
    """Append map textures while preserving all Beaver resources.

    items: [{name, source_path, use_alpha, material}]
    replace_special: optional fixed replacements (e.g. sky slot 30/minimap slot31).
    """
    ref,h,entries=peg.parse_peg(reference_peg)
    # First apply sky/minimap into the existing fixed slots if requested.
    base_path=Path(output_peg).with_suffix('.base.tmp')
    special=dict(replace_special or {})
    if special:
        peg.build_fixed_from_reference(reference_peg,base_path,special)
        raw,h,entries=peg.parse_peg(base_path)
    else:
        raw=ref

    # Pick proven entry templates for dynamic opaque/alpha resources.
    tmpl_dxt1=next(e for e in entries if e.fmt==peg.FMT_DXT1 and e.name.lower().endswith('.tga'))
    tmpl_dxt5=next(e for e in entries if e.fmt==peg.FMT_DXT5 and e.flags_byte==1)
    built=[]
    # Preserve existing entries/payloads byte-for-byte except recalc their physical offsets later.
    for e in entries:
        built.append([bytearray(e.raw),bytes(e.payload),{'name':e.name,'existing':True,'index':e.index}])

    # Fail closed on duplicate names, including donor entries. A duplicated
    # resource key can bind a material to another texture at game runtime.
    import collections
    all_names = [e.name for e in entries] + [str(it['name']) for it in items]
    duplicates = [k for k,n in collections.Counter(x.casefold() for x in all_names).items() if n>1]
    if duplicates:
        raise RuntimeError('Duplicate PEG resource names (case-insensitive): ' + ', '.join(duplicates))
    report=[]
    for it in items:
        use_alpha=bool(it.get('use_alpha',False))
        fmt=peg.FMT_DXT5 if use_alpha else peg.FMT_DXT1
        tmpl=tmpl_dxt5 if use_alpha else tmpl_dxt1
        im,src_sz,out_sz=normalized_image(it['source_path'],use_alpha)
        payload,kind=_encoded_payload(im,fmt)
        rawent=bytearray(tmpl.raw)
        name=str(it['name'])
        peg._write_name(rawent,name)
        struct.pack_into('>HHH',rawent,0x04,im.width,im.height,fmt)
        surface_id=int(it.get('surface_id',0))
        if not 0 <= surface_id <= 21:
            raise ValueError(f'Invalid physical surface ID {surface_id} for texture {name}')
        # Retail PEG directory +0x0A is NOT the physical material ID.
        # The engine assigns it in its separate 20-byte runtime bitmap registry;
        # 1,909 scanned retail entries store 0 in this 0x48-byte disk field.
        # Preserve the donor template value instead of writing the runtime SID.
        # Material intent travels in the name suffix and export manifest.
        # Runtime late-PEG placeholder repair is handled by optional WML mod.
        assert len(rawent) >= 0x0C
        rawent[0x14]=1 if use_alpha else 0
        rawent[0x15]=1; rawent[0x16]=1
        struct.pack_into('>I',rawent,0x34,len(payload))
        rawent[0x38:0x48]=b'\0'*0x10
        idx=len(built)
        rec={'index':idx,'name':name,'source':str(it['source_path']),'material':it.get('material'),
             'source_size':list(src_sz),'size':list(out_sz),'fmt':fmt,'kind':kind,'frame_size':len(payload),'use_alpha':use_alpha,'surface_id':surface_id}
        built.append([rawent,payload,rec]); report.append(rec)

    total_payload_bytes=sum(int(r['frame_size']) for r in report)
    # This report permits real A/B comparison without inventing an engine cap.
    for r in report:
        r['texture_cap']=1024
    count=len(built)
    if count > 0xFFFF:
        raise RuntimeError(f'PEG entry count exceeds the 16-bit format field: {count}')
    dir_size=peg.HEADER_SIZE+count*peg.ENTRY_SIZE
    first_existing=min(e.data_offset for e in entries)
    # v0.16 removes Beaver's old 24-added-texture limit.  If the enlarged
    # directory no longer fits before the original first payload page (0x1000
    # in Beaver Creek), move the entire payload area to the next 0x1000 page
    # and rewrite EVERY entry offset.  Existing texture payload bytes are kept
    # intact; only their physical file offsets change.
    data_start=max(first_existing,peg.align(dir_size,0x1000))
    data_blob=bytearray(); offsets=[]
    for rawent,payload,info in built:
        pad=peg.align(len(data_blob),0x1000)-len(data_blob)
        if pad:data_blob+=b'\0'*pad
        offsets.append(data_start+len(data_blob)); data_blob+=payload
    data_blob+=b'\0'*(peg.align(len(data_blob),0x1000)-len(data_blob))
    out=bytearray(data_start+len(data_blob))
    # Preserve original header flags/alignment while updating both entry counts.
    struct.pack_into('>IHHIIHHHH',out,0,h.signature,h.version,h.platform,dir_size,len(data_blob),count,h.flags,count,h.alignment)
    for i,(rawent,payload,info) in enumerate(built):
        struct.pack_into('>I',rawent,0,offsets[i])
        out[peg.HEADER_SIZE+i*peg.ENTRY_SIZE:peg.HEADER_SIZE+(i+1)*peg.ENTRY_SIZE]=rawent
    out[data_start:]=data_blob
    Path(output_peg).write_bytes(out)
    try: base_path.unlink()
    except Exception: pass
    # Structural reparse.
    _,hh,ee=peg.parse_peg(output_peg)
    if hh.count!=count or len(ee)!=count: raise RuntimeError('dynamic PEG failed to reparse')
    return {'count':count,'old_count':h.count,'added':report,'data_start':data_start,'data_size':len(data_blob),'directory_size':dir_size,'payload_relocated':data_start!=first_existing,'original_data_start':first_existing,'new_texture_payload_bytes':total_payload_bytes,'texture_resolution_cap':1024}


def _clone_material_resource_links(g, base_idx, new_material_key):
    """Clone the donor's 0x10-stride material resource-link records.

    Retail sub_8224D220 -> sub_8224CD70 searches this table by
    (material+0x04, descriptor tag).  Creating a new material hash without
    matching secondary records makes every linking lookup fail silently.
    """
    old_key = rc.U32(g.mats[base_idx].m, 4)
    donors = [e for e in g.ents if rc.U32(e.e, 4) == old_key]
    if not donors:
        raise RuntimeError('source material has no secondary resource-link records')
    if any(rc.U32(e.e, 4) == new_material_key for e in g.ents):
        raise RuntimeError('duplicate material resource-link key 0x%08X' % new_material_key)
    for source in donors:
        item = copy.deepcopy(source)
        rc.Wr32(item.e, 4, new_material_key)
        # On disk, +0x0C is a pointer-presence marker.  The loader
        # recreates its target at load time; each referenced slot starts 0.
        item.x = bytearray(len(source.x))
        g.ents.append(item)


def _sort_and_validate_material_resource_links(g):
    g.ents.sort(key=lambda e: (rc.U32(e.e, 4), rc.U32(e.e, 0)))
    if len(g.ents) > 0xFFFF:
        raise RuntimeError('material secondary record table exceeds uint16 count')
    rc.Wr16(g.mathdr, 2, len(g.ents))
    pairs = {(rc.U32(e.e, 0), rc.U32(e.e, 4)) for e in g.ents}
    for slot, material in enumerate(g.mats):
        key = rc.U32(material.m, 4)
        for i in range(rc.U16(material.m, 0x0A)):
            tag = rc.U32(material.parts[0], i*12)
            if (tag, key) not in pairs:
                raise RuntimeError('material %d missing descriptor resource-link 0x%08X / 0x%08X' % (slot, tag, key))


def _clone_material(g,base_idx,name_hash,string_idx):
    M=copy.deepcopy(g.mats[base_idx])
    rc.Wr32(M.m,4,name_hash)
    if not M.parts or len(M.parts[0])<12: raise RuntimeError('template material has no diffuse texture parameter')
    rc.Wr32(M.parts[0],4,string_idx)
    return M


def upgrade_bbchunk_dynamic(bbchunk_path,bb_report,map_name,materials,texture_mapping,alpha_mapping=None,log=None):
    """Grow material/string tables and replace collision with the Saints Reborn MOPP builder."""
    say=log or (lambda x:None)
    alpha_mapping=dict(alpha_mapping or {})
    p=Path(bbchunk_path); ch=rc.read_chunk(p.read_bytes()); g=rc.chunk_geometry(ch)
    strings_before=rc.chunk_strings(ch)

    # Find proven Beaver opaque and blend materials.
    opaque=None; alpha=None
    for i,M in enumerate(g.mats):
        if rc.U32(M.m,0)!=K_BASE_SHADER: continue
        flags=rc.U16(M.m,0x12)
        if opaque is None and flags==3: opaque=i
        if alpha is None and flags in (11,27): alpha=i
    if opaque is None: raise RuntimeError('Beaver template has no plain material to clone')
    if alpha is None: alpha=opaque

    # New unique names are referenced by BBChunk string-table index, not PEG physical slot.
    tex_items=[]; names=[]
    for i,mat in enumerate(materials):
        name=f'{map_name}_t{i:02d}.tga'
        if len(name.encode('ascii'))>=peg.NAME_LEN:
            # map_name is already <=11, but keep this future-proof.
            name=f'm{i:03d}_{map_name[:8]}.tga'
        names.append(name)
        tex_items.append({'name':name,'source_path':texture_mapping[mat],'use_alpha':bool(alpha_mapping.get(mat,False)),'material':mat})
    str_idx=rc.add_strings(ch,names)

    mat_ids={}
    for i,mat in enumerate(materials):
        base=alpha if alpha_mapping.get(mat,False) else opaque
        mid=len(g.mats)
        material_key = rc.crc32_sr(f'{map_name}/{i}')
        _clone_material_resource_links(g, base, material_key)
        g.mats.append(_clone_material(g,base,material_key,str_idx[i]))
        mat_ids[mat]=mid
    rc.Wr16(g.mathdr,0,len(g.mats))
    _sort_and_validate_material_resource_links(g)

    # Patch each imported render mesh to its freshly appended material.
    active=[]
    for r in bb_report.get('render',[]):
        if int(r.get('triangles',0))<=0 or not r.get('material'): continue
        k=int(r['mesh']); mat=r['material']
        if mat not in mat_ids: raise RuntimeError(f'no dynamic material for render mesh {k}: {mat}')
        for S in g.meshes[k].subs:
            nb=rc.U16(S.s16,2)
            for b in range(nb): rc.Wr16(S.b16,8*b+6,mat_ids[mat])
        active.append(k)

    # Preserve the sky's existing material 28 and rebuild collision directly from visible render meshes.
    has_coll=[False]*len(g.meshes)
    for k in active: has_coll[k]=True
    inst=ch.get('instances').data
    say(f'    Reborn MOPP: rebuilding collision from {len(active)} active render meshes...')
    ninst=rc.rebuild_collision(g,inst,has_coll)
    blocks=rc.parse_mopp_blocks(g.coll)
    checked=0
    for k in active:
        keys=rc.mopp_keys(blocks[k]['code']); tris=rc.mesh_triangles(g,k)
        if len(keys)!=len(tris): raise RuntimeError(f'Reborn MOPP validation failed on mesh {k}: {len(keys)} keys vs {len(tris)} triangles')
        checked+=len(tris)

    rc.set_geometry(ch,g); out=rc.write_chunk(ch)
    # Reparse written result for structural validation.
    check=rc.read_chunk(out); g2=rc.chunk_geometry(check)
    if len(g2.mats)!=len(g.mats): raise RuntimeError('dynamic material table did not survive BBChunk round-trip')
    p.write_bytes(out)
    return {'old_strings':len(strings_before),'new_strings':len(rc.chunk_strings(check)),'old_materials':len(g.mats)-len(materials),
            'new_materials':len(g.mats),'material_ids':mat_ids,'texture_items':tex_items,
            'collision_triangles':checked,'collision_instances':ninst,'mopp_blocks':len(blocks)}

# ---------------- v0.17 native multi-batch render builder ----------------
# Ported from the Saints Reborn converter's VBOut/Strip strategy, adapted to
# Caboose Beaver Creek's proven 24-byte class-2 vertex format so the easy
# OBJ/MTL workflow does not require Blender or the converter EXE.

import sr1_obj_core as _objcore
import beaver_bbchunk as _beaver

class _Strip24:
    def __init__(self): self.s=[]
    def add(self,a,b,c):
        if not self.s:
            self.s=[a,b,c]; return
        n=len(self.s); x,y=self.s[-2],self.s[-1]; even=((n-2)&1)==0
        for r in ((a,b,c),(b,c,a),(c,a,b)):
            if (even and r[0]==x and r[1]==y) or ((not even) and r[0]==y and r[1]==x):
                self.s.append(r[2]); return
        last=self.s[-1]
        self.s.append(last)
        if len(self.s)%2==0: self.s.append(last)
        self.s.extend((a,a,b,c))

class _VB24:
    def __init__(self):
        self.vd=bytearray(); self.ib=[]; self.lookup={}; self.batches=[]
        self.strip=_Strip24(); self.strip_mat=None; self.strip_faces=0; self.tris=0
        self.mn=[1e30,1e30,1e30]; self.mx=[-1e30,-1e30,-1e30]
    @property
    def verts(self): return len(self.vd)//24
    def flush(self):
        if not self.strip.s: return
        self.batches.append({'first':len(self.ib),'count':len(self.strip.s),'mat':int(self.strip_mat),'triangles':self.strip_faces})
        self.ib.extend(self.strip.s); self.strip.s=[]; self.strip_faces=0
    def vertex(self,v,p):
        key=bytes(v); old=self.lookup.get(key)
        if old is not None: return old
        idx=self.verts
        if idx>=65535: raise RuntimeError('internal 16-bit vertex overflow')
        self.vd.extend(v); self.lookup[key]=idx
        for a in range(3): self.mn[a]=min(self.mn[a],p[a]); self.mx[a]=max(self.mx[a],p[a])
        return idx


def _replace_chunk_string(ch,old,new):
    # Rebuild the string blob rather than padding a shorter replacement with
    # extra NULs. The table is sequential: padding would be parsed as extra
    # empty names once v0.17 appends dynamic texture strings.
    b=ch.get('strings').data
    n=rc.U32(b,0); c=4+4*n; names=[]
    for _ in range(n):
        z=b.find(0,c)
        if z<0: raise RuntimeError('bad BBChunk string table')
        names.append(bytes(b[c:z]).decode('ascii','replace')); c=z+1
    hit=False
    for i,s in enumerate(names):
        if s==old:
            names[i]=str(new); hit=True; break
    if not hit: return False
    out=bytearray(); rc.Put32(out,n); out+=b[4:4+4*n]
    for s in names: out+=s.encode('ascii','strict')+b'\0'
    ch.get('strings').data=out
    return True


def _pack_vertex24(p,frame,uv,shift_u,shift_v,clip_state):
    n,t,sign=frame
    u=(uv[0] if uv is not None else 0.0)-shift_u
    v=(uv[1] if uv is not None else 0.0)-shift_v
    qu=round(float(u)*1024.0); qv=round(float(v)*1024.0)
    if qu>32767 or qu<-32768 or qv>32767 or qv<-32768: clip_state[0]=True
    qu=max(-32768,min(32767,int(qu))); qv=max(-32768,min(32767,int(qv)))
    return struct.pack('>3fIIhh',float(p[0]),float(p[1]),float(p[2]),_objcore.pack_dec3n(n,0),_objcore.pack_tangent(t,sign),qu,qv)



def _face_safe_frame(frame, face_normal, min_dot=0.05):
    """Keep smooth/authored normals when they face the triangle, but repair
    pathological averaged normals that point through the back of a face.

    Large OBJ maps often contain a small number of corners without authored
    normals. build_vertex_frames() smooths those across every face sharing the
    native OBJ corner. On folded/non-manifold geometry that average can oppose a
    particular face even though the face winding itself is correct.

    Returning a face-local frame is safe because the packed-vertex deduper keys
    the entire 24-byte vertex. Only the affected face gets a split vertex.
    """
    n,t,sign=frame
    d=n[0]*face_normal[0]+n[1]*face_normal[1]+n[2]*face_normal[2]
    if d > min_dot:
        return frame, False
    n=face_normal
    ndt=n[0]*t[0]+n[1]*t[1]+n[2]*t[2]
    tt=(t[0]-n[0]*ndt,t[1]-n[1]*ndt,t[2]-n[2]*ndt)
    tl=math.sqrt(tt[0]*tt[0]+tt[1]*tt[1]+tt[2]*tt[2])
    if tl <= 1.0e-12:
        tt=_objcore.fallback_tangent(n)
    else:
        tt=(tt[0]/tl,tt[1]/tl,tt[2]/tl)
    return (n,tt,sign), True


def _reverse_frame(frame):
    # Back-side copy: reverse the surface normal but preserve the tangent axis.
    # Flipping the tangent handedness keeps the derived bitangent consistent
    # with the same UV orientation on the reversed triangle.
    n,t,sign=frame
    return ((-n[0],-n[1],-n[2]), t, -sign)


def _stretch_tree_bounds(section,mn,mx):
    if len(section)<4: return
    nn=rc.U32(section,0); at=rc.Al(4,64)
    if at+44*nn>len(section): return
    for i in range(nn):
        e=at+44*i
        for a in range(3):
            rc.WrF(section,e+4*a,mn[a]); rc.WrF(section,e+16+4*a,mx[a])


def _generic_normal_alignment(g,mesh_ids):
    vals=[]; checked=0; numerical_slivers=0
    for k in mesh_ids:
        M=g.meshes[k]
        for S in M.subs:
            vi=rc.U32(S.s16,8); V=g.vbs[vi]; st=rc.U16(V.desc,16)
            for b in range(rc.U16(S.s16,2)):
                first=rc.U32(S.b16,8*b); cnt=rc.U16(S.b16,8*b+4)
                idx=[rc.U16(V.ib,2*(first+i)) for i in range(cnt)]
                for end in range(2,len(idx)):
                    a,bv,c=idx[end-2],idx[end-1],idx[end]
                    if a==bv or bv==c or a==c: continue
                    if ((end-2)&1): a,bv=bv,a
                    def pos(q): return (rc.F32(V.vd,st*q),rc.F32(V.vd,st*q+4),rc.F32(V.vd,st*q+8))
                    def normal(q): return _objcore.decode_dec3n_word(rc.U32(V.vd,st*q+12))[0]
                    p0,p1,p2=pos(a),pos(bv),pos(c)
                    e1=(p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]); e2=(p2[0]-p0[0],p2[1]-p0[1],p2[2]-p0[2])
                    gn=(e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0])
                    gl2=sum(x*x for x in gn); l12=sum(x*x for x in e1); l22=sum(x*x for x in e2)
                    if gl2<1e-24 or l12<1e-24 or l22<1e-24: continue
                    # A triangle this close to collinear can change apparent
                    # orientation after its positions are rounded to float32.
                    # It has no useful surface normal, so don't treat it as a
                    # map-wide handedness failure.
                    if gl2/(l12*l22) < 1.0e-12:
                        numerical_slivers += 1
                        continue
                    gl=math.sqrt(gl2); gn=tuple(x/gl for x in gn)
                    ns=[normal(a),normal(bv),normal(c)]
                    nn=tuple(sum(q[i] for q in ns) for i in range(3)); nl=math.sqrt(sum(x*x for x in nn))
                    if nl<1e-12: continue
                    nn=tuple(x/nl for x in nn); al=sum(gn[i]*nn[i] for i in range(3))
                    vals.append(al); checked+=1
    if not vals:
        return {'triangles_checked':0,'negative':0,'mean_alignment':0.0,'min_alignment':0.0,
                'numerical_slivers_ignored':numerical_slivers}
    return {'triangles_checked':checked,'negative':sum(1 for x in vals if x < -0.02),
            'mean_alignment':sum(vals)/len(vals),'min_alignment':min(vals),
            'numerical_slivers_ignored':numerical_slivers}



def _float32_face_quality(p0, p1, p2, source_normal):
    """Return the alignment and relative area after Xbox float32 quantization.

    This must be checked *before* emitting a face: very fine triangles in
    large scenes may collapse or reverse once coordinates are packed as >f.
    """
    try:
        pts=[struct.unpack('>3f',struct.pack('>3f',*map(float,p))) for p in (p0,p1,p2)]
    except (OverflowError, struct.error):
        return -1.0, 0.0
    a,b,c=pts
    u=tuple(b[i]-a[i] for i in range(3))
    v=tuple(c[i]-a[i] for i in range(3))
    cross=(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])
    gl2=sum(x*x for x in cross)
    l12=sum(x*x for x in u)
    l22=sum(x*x for x in v)
    if gl2 < 1e-24 or l12 < 1e-24 or l22 < 1e-24:
        return -1.0, 0.0
    rel=gl2/(l12*l22)
    gl=math.sqrt(gl2)
    alignment=sum(cross[i]*source_normal[i] for i in range(3))/gl
    return alignment, rel


def _apply_obj_export_conventions(obj, mirror_x=True, flip_v=True):
    """Convert direct Wavefront OBJ data into the same SR1 conventions used by
    the Saints Reborn glTF importer.

    SR1 map geometry is left-handed; the Reborn importer mirrors X when taking
    right-handed glTF into game space. Wavefront OBJ texture coordinates also
    need a V-origin conversion for the PEG image orientation used by the game.

    Mirroring one axis reverses winding, so B/C are swapped and authored normals
    have their X component mirrored as well.
    """
    out=dict(obj)
    if mirror_x:
        out['verts']=[(-float(v[0]), float(v[1]), float(v[2])) for v in obj['verts']]
        out['faces']=[(f[0], f[2], f[1], f[3]) for f in obj['faces']]
        src=[]
        for n in obj.get('src_normals',[]):
            src.append(None if n is None else (-float(n[0]), float(n[1]), float(n[2])))
        out['src_normals']=src
    else:
        out['verts']=list(obj['verts'])
        out['faces']=list(obj['faces'])
        out['src_normals']=list(obj.get('src_normals',[]))
    if flip_v:
        out['uv0']=[None if q is None else (float(q[0]), 1.0-float(q[1])) for q in obj.get('uv0',[])]
    else:
        out['uv0']=list(obj.get('uv0',[]))
    return out

PHYSICAL_SURFACE_SUFFIX=physical.SUFFIXES

def build_bbchunk_multibatch(obj_path,reference_path,output_path,texture_mapping,map_name,alpha_mapping=None,surface_mapping=None,
                             world_scale=0.50,minimap_name=None,log=None,report_path=None,
                             mirror_x=True,flip_obj_v=True,double_sided=False,sky_scale=0.0,preserve_fake_sky=False,
                             _force_face_normals=False,fixed_origin=None,render_only_scene_indices=None,double_sided_scene_indices=None,render_only_face_indices=None):
    """Build the render geometry the way Saints Reborn does: multiple material
    batches per mesh/VB. This removes the old one-material-per-Beaver-slot cap.
    The donor sky mesh (118) is kept ONLY if the user selects a fake sky image.
    """
    say=log or (lambda x:None); alpha_mapping=dict(alpha_mapping or {}); surface_mapping=dict(surface_mapping or {})
    source=_objcore.parse_obj_attrs(obj_path)
    source,orientation=_objcore.orient_faces_to_source_normals(source)
    obj,transform=_beaver.transform_obj_for_sr1(source,world_scale,fixed_origin=fixed_origin)
    obj=_apply_obj_export_conventions(obj,mirror_x=bool(mirror_x),flip_v=bool(flip_obj_v))
    transform['mirror_x']=bool(mirror_x); transform['flip_obj_v']=bool(flip_obj_v); transform['double_sided']=bool(double_sided)
    verts=obj['verts']; faces=obj['faces']; uv0=obj['uv0']
    if not verts or not faces: raise RuntimeError('OBJ is empty')
    frames,frame_stats=_objcore.build_vertex_frames(verts,faces,uv0,obj['src_normals'])
    materials=[]; seen=set()
    for f in faces:
        m=str(f[3] or '(default)')
        if m not in seen: seen.add(m); materials.append(m)
    missing=[m for m in materials if not texture_mapping.get(m) or not Path(texture_mapping[m]).is_file()]
    if missing: raise RuntimeError('missing texture assignment(s): '+', '.join(missing))

    ch=rc.read_chunk(Path(reference_path).read_bytes()); g=rc.chunk_geometry(ch)
    if len(g.meshes)!=119 or len(g.vbs)!=119: raise RuntimeError('reference is not the expected 119-mesh Beaver chunk')
    if minimap_name:
        _replace_chunk_string(ch,'beavercreek.tga',str(minimap_name))
        raw=str(minimap_name).encode('ascii','strict')
        if len(raw)>0x3f: raise RuntimeError('minimap resource name too long')
        ch.header[0x10:0x50]=raw+b'\0'+b'\0'*(0x40-len(raw)-1)

    # Dynamic texture names + materials, directly following the Reborn builder.
    opaque=alpha=None
    for i,M in enumerate(g.mats):
        if rc.U32(M.m,0)!=K_BASE_SHADER: continue
        fl=rc.U16(M.m,0x12)
        if opaque is None and fl==3: opaque=i
        if alpha is None and fl in (11,27): alpha=i
    if opaque is None: raise RuntimeError('Beaver template has no plain material to clone')
    if alpha is None: alpha=opaque
    tex_items=[]; tex_names=[]
    for i,m in enumerate(materials):
        # Retail lookup also identifies surface types from texture-name suffixes.
        # Keep this in sync with the numeric PEG surface ID, not just the PEG metadata.
        sid=int(surface_mapping.get(m,0))
        name=physical.name_for_export(map_name,i,sid,texture_mapping[m],bool(alpha_mapping.get(m,False)))
        tex_names.append(name); tex_items.append({'name':name,'source_path':texture_mapping[m],'use_alpha':bool(alpha_mapping.get(m,False)),'material':m})
    str_idx=rc.add_strings(ch,tex_names)
    mat_ids={}
    for i,m in enumerate(materials):
        base=alpha if alpha_mapping.get(m,False) else opaque
        mid=len(g.mats)
        material_key=rc.crc32_sr(f'{map_name}/{i}')
        _clone_material_resource_links(g,base,material_key)
        g.mats.append(_clone_material(g,base,material_key,str_idx[i]))
        mat_ids[m]=mid
    rc.Wr16(g.mathdr,0,len(g.mats))
    _sort_and_validate_material_resource_links(g)

    # Multi-batch VB packing from the Saints Reborn source, using Beaver's 24-byte vertex format.
    # When double_sided is requested, keep the original front-side meshes intact for collision,
    # then build a second set of reversed-winding render-only meshes. This reproduces the editor's
    # GL_CULL_FACE-off appearance without doubling Havok MOPP collision.
    mat_rank={m:i for i,m in enumerate(materials)}
    # Preserve the original base-map mesh packing when new scene objects are added.
    # sr1_scene names each object's materials objNNN_<material>.  Keep the
    # obj000_ base terrain's face/material order stable, and never let a
    # placed object contribute vertices to a terrain VB or collision MOPP.
    # Scene objects after index zero may be established terrain pieces, NOT GLBs.
    # Only explicit GLB indices from the saved scene are render-only. This also
    # handles multiple GLBs, while all other terrain pieces retain collision.
    glb_indices={int(x) for x in (render_only_scene_indices or [])}
    excluded_face_ids={int(x) for x in (render_only_face_indices or [])}
    if any(x<0 or x>=len(faces) for x in excluded_face_ids): raise ValueError("Invalid collision-excluded face index")
    two_sided_indices={int(x) for x in (double_sided_scene_indices or [])}
    if any(x<0 or x>999 for x in two_sided_indices): raise ValueError("Invalid scene object index for two-sided rendering")
    def _two_sided_face(fi):
        material=str(faces[fi][3] or "(default)")
        match=re.match(r"^obj(\d{3})_",material)
        return bool(match and int(match.group(1)) in two_sided_indices)
    def _scene_group(fi):
        material=str(faces[fi][3] or '(default)')
        match=re.match(r'^obj(\d{3})_',material)
        return 1 if fi in excluded_face_ids or (match and int(match.group(1)) in glb_indices) else 0
    scene_groups={_scene_group(fi) for fi in range(len(faces))}
    order=sorted(range(len(faces)),key=lambda fi:(_scene_group(fi),mat_rank[str(faces[fi][3] or '(default)')]))

    clipped=[False]; degenerate=0; near_collinear=0; float32_unsafe=0; face_normal_repairs=0

    # Keep each collision MOPP tree small enough that its 16-bit branch offsets
    # cannot overflow. A mesh containing ~20k triangles can produce a left
    # subtree > 65535 bytes even though its vertex/index buffers are valid.
    # 5000 faces per mesh is conservative for this MOPP instruction encoding.
    def build_side(back=False):
        nonlocal degenerate,near_collinear,float32_unsafe,face_normal_repairs
        # Only front meshes participate in Havok collision. Back meshes can
        # safely use a higher triangle cap, avoiding donor render-slot overflow
        # without risking the 16-bit MOPP branch-offset limit.
        triangle_cap=12000 if back else 5000
        side=[_VB24()]
        side[-1].scene_group=None
        last_group=None
        for fi in order:
            if back and not (double_sided or _two_sided_face(fi)): continue
            group=_scene_group(fi)
            # Flush at the object boundary even when the previous VB is not
            # full, so collision keys, per-mesh bounds and render batches stay
            # isolated from the base terrain.
            if last_group is not None and group != last_group and side[-1].tris:
                side[-1].flush(); side.append(_VB24())
                side[-1].scene_group=None
            last_group=group
            f=faces[fi]; a,b,c=f[:3]; mat=str(f[3] or '(default)')
            p0,p1,p2=verts[a],verts[b],verts[c]
            e1=(p1[0]-p0[0],p1[1]-p0[1],p1[2]-p0[2]); e2=(p2[0]-p0[0],p2[1]-p0[1],p2[2]-p0[2])
            cross=(e1[1]*e2[2]-e1[2]*e2[1],e1[2]*e2[0]-e1[0]*e2[2],e1[0]*e2[1]-e1[1]*e2[0])
            gl2=sum(x*x for x in cross); l12=sum(x*x for x in e1); l22=sum(x*x for x in e2)
            if gl2<1e-14 or l12<1e-20 or l22<1e-20:
                if not back: degenerate+=1
                continue
            if gl2/(l12*l22) < 1.0e-12:
                if not back: near_collinear+=1
                continue
            gl=math.sqrt(gl2); face_n=(cross[0]/gl,cross[1]/gl,cross[2]/gl)
            # Do not export a triangle that will become inverted or effectively
            # collinear after float32 coordinate storage. Both front and back
            # builds use the same test, keeping rendering and collision aligned.
            packed_alignment,packed_area=_float32_face_quality(p0,p1,p2,face_n)
            if packed_alignment <= 0.02 or packed_area < 1.0e-12:
                if not back: float32_unsafe+=1
                continue
            V=side[-1]
            if V.tris>=triangle_cap or V.verts+3>65535 or len(V.ib)+len(V.strip.s)+8>65535:
                V.flush(); side.append(_VB24()); V=side[-1]
                V.scene_group=None
            if V.scene_group is None: V.scene_group=group
            gm=mat_ids[mat]
            if V.strip_mat!=gm:
                V.flush(); V.strip_mat=gm
            uvs=[uv0[a],uv0[b],uv0[c]]
            su=math.floor(sum((q[0] if q is not None else 0.0) for q in uvs)/3.0)
            sv=math.floor(sum((q[1] if q is not None else 0.0) for q in uvs)/3.0)
            corners=(a,c,b) if back else (a,b,c)
            ids=[]
            for q in corners:
                safe_frame,repaired=_face_safe_frame(frames[q],face_n)
                if _force_face_normals:
                    # Strict second-pass fallback: all triangle corners receive
                    # their own geometric face normal. Preserve UVs/materials.
                    safe_frame,_=_face_safe_frame(((-face_n[0],-face_n[1],-face_n[2]),
                                                  safe_frame[1],safe_frame[2]), face_n)
                if repaired and not back: face_normal_repairs+=1
                if back: safe_frame=_reverse_frame(safe_frame)
                vb=_pack_vertex24(verts[q],safe_frame,uv0[q],su,sv,clipped)
                ids.append(V.vertex(vb,verts[q]))
            V.strip.add(*ids); V.strip_faces+=1; V.tris+=1
        side[-1].flush()
        if side and side[-1].tris==0: side.pop()
        return side

    front_outs=build_side(False)
    if not front_outs: raise RuntimeError('OBJ contained no non-degenerate triangles')
    back_outs=build_side(True) if (double_sided or two_sided_indices) else []
    outs=front_outs+back_outs
    front_mesh_count=len(front_outs)
    inst=ch.get('instances').data; recs=ch.get('static_records').data
    nrec=rc.U32(ch.header,868); ninst=len(inst)//112
    inst_use=[0]*ninst
    for r in range(nrec):
        ii=rc.I32(recs,80*r+60)
        if 0<=ii<ninst: inst_use[ii]+=1
    # Locate/preserve the sky record/instance by its mesh 118 linkage.
    sky_mesh=118; sky_inst=None; sky_rec=None
    for r in range(nrec):
        ii=rc.I32(recs,80*r+60)
        if 0<=ii<ninst and rc.U32(inst,112*ii+104)==sky_mesh:
            sky_inst=ii; sky_rec=r; break
    free_recs=[]
    for r in range(nrec):
        ii=rc.I32(recs,80*r+60)
        if r==sky_rec: continue
        if 0<=ii<ninst and inst_use[ii]==1 and (rc.U32(recs,80*r+32)&0x10000000): free_recs.append(r)
    free_meshes=[k for k,M in enumerate(g.meshes) if k!=sky_mesh and not M.has48 and M.subs]
    if len(free_meshes)<2: raise RuntimeError('Beaver template has no spare render meshes')
    empty_mesh=free_meshes[-1]; usable_meshes=free_meshes[:-1]
    if len(outs)>min(len(free_recs),len(usable_meshes),len(g.vbs)-2):
        raise RuntimeError(f'map needs {len(outs)} Reborn-style render buffers'+(' with double-sided export' if double_sided else '')+f' but Beaver template can host only {min(len(free_recs),len(usable_meshes),len(g.vbs)-2)}')
    desc_tmpl=bytearray(next(V.desc for V in g.vbs if rc.U16(V.desc,16)==24 and rc.U32(V.desc,4) and rc.U32(V.desc,8)))
    s16_tmpl=bytearray(g.meshes[usable_meshes[0]].subs[0].s16)
    our_meshes=[]; collision_meshes=[]; render=[]; used_inst=set(); has_coll=[False]*len(g.meshes)
    map_mn=[1e30]*3; map_mx=[-1e30]*3
    for j,O in enumerate(outs):
        vi=j; V=g.vbs[vi]; V.desc=bytearray(desc_tmpl)
        rc.Wr16(V.desc,0,min(O.tris,65535)); rc.Wr16(V.desc,12,O.verts); rc.Wr16(V.desc,14,len(O.ib)); rc.Wr16(V.desc,16,24)
        V.has_aux=False; V.aux_header=bytearray(); V.aux_a=bytearray(); V.aux_b=bytearray(); g.auxflag[vi]=0
        V.vd=bytearray(O.vd); V.ib=bytearray()
        for x in O.ib: rc.Put16(V.ib,x)
        k=usable_meshes[j]; M=g.meshes[k]
        for a in range(3):
            rc.WrF(M.hdr,4*a,O.mn[a]); rc.WrF(M.hdr,12+4*a,O.mx[a]); map_mn[a]=min(map_mn[a],O.mn[a]); map_mx[a]=max(map_mx[a],O.mx[a])
        rc.Wr16(M.hdr,28,1); rc.Wr32(M.hdr,36,0)
        sm=rc.SubMesh(s16=bytearray(s16_tmpl)); rc.Wr16(sm.s16,2,len(O.batches)); rc.Wr32(sm.s16,8,vi)
        for bi,b in enumerate(O.batches):
            rc.Put32(sm.b16,b['first']); rc.Put16(sm.b16,b['count']); rc.Put16(sm.b16,b['mat'])
            mat=materials[next(i for i,m in enumerate(materials) if mat_ids[m]==b['mat'])]
            render.append({'mesh':k,'batch':bi,'material':mat,'material_id':b['mat'],'first_index':b['first'],'index_count':b['count'],'triangles':b['triangles']})
        M.subs=[sm]; our_meshes.append(k)
        # Compatibility mode: keep all imported GLB meshes renderable but do
        # not feed them into the donor map's MOPP collision rebuild. Terrain
        # retains its exact collision behavior.
        terrain_front=(j < front_mesh_count and O.scene_group == 0)
        has_coll[k]=terrain_front
        if terrain_front: collision_meshes.append(k)
        r=free_recs[j]; ii=rc.I32(recs,80*r+60); used_inst.add(ii); ia=112*ii
        rc.Wr32(inst,ia+104,k)
        for a in range(3): rc.WrF(inst,ia+4+4*a,0.0)
        I9=(1,0,0,0,1,0,0,0,1)
        for a,x in enumerate(I9): rc.WrF(inst,ia+16+4*a,float(x))
        for a in range(3): rc.WrF(recs,80*r+4*a,O.mn[a]); rc.WrF(recs,80*r+16+4*a,O.mx[a])
    # Empty every other ordinary mesh; keep sky mesh 118 byte-structurally alive.
    trash_vb=len(outs)
    if trash_vb==118: trash_vb=117
    if trash_vb>=len(g.vbs): trash_vb=0
    for k,M in enumerate(g.meshes):
        if k in our_meshes or (preserve_fake_sky and k==sky_mesh): continue
        for S in M.subs:
            rc.Wr16(S.s16,2,0); S.b16=bytearray(); rc.Wr32(S.s16,8,trash_vb)
            if S.has12: rc.Wr16(S.s12,2,0); S.b12=bytearray()
    if preserve_fake_sky and sky_inst is not None: used_inst.add(sky_inst)
    if not preserve_fake_sky and sky_rec is not None:
        # Explicitly invalidate donor sky record's render bit, not just its triangle buffer.
        rc.Wr32(recs,80*sky_rec+32,rc.U32(recs,80*sky_rec+32)&~0x10000000)
    for i in range(ninst):
        if i not in used_inst: rc.Wr32(inst,112*i+104,empty_mesh)

    mn=tuple(map_mn); mx=tuple(map_mx)
    # Sky is a separate donor mesh/instance: enlarge it without touching map geometry,
    # MOPP collision, material batches, or the sky vertex buffer.
    sky_info={'mode':('auto' if float(sky_scale)==0 else 'manual') if preserve_fake_sky else 'disabled',
              'requested_scale':float(sky_scale),'applied_scale':1.0,'fake_sky_enabled':bool(preserve_fake_sky)}
    if preserve_fake_sky and sky_inst is not None:
        h=g.meshes[sky_mesh].hdr
        local_min=[rc.F32(h,4*a) for a in range(3)]
        local_max=[rc.F32(h,12+4*a) for a in range(3)]
        local_center=[(local_min[a]+local_max[a])*0.5 for a in range(3)]
        local_radius=[(local_max[a]-local_min[a])*0.5 for a in range(3)]
        map_center=[(mn[a]+mx[a])*0.5 for a in range(3)]
        map_radius=[(mx[a]-mn[a])*0.5 for a in range(3)]
        if float(sky_scale)<0 or not math.isfinite(float(sky_scale)):
            raise ValueError('Skybox scale must be 0 (auto) or a positive number')
        if float(sky_scale)==0:
            # Allow 20 percent clearance around every axis of the map.
            scale=max(1.0,max((r*1.20)/d for r,d in zip(map_radius,local_radius) if d>0))
        else:
            scale=float(sky_scale)
        if scale>100.0: raise ValueError('Skybox scale exceeds the 100x safety limit')
        ia=112*sky_inst
        for a in range(3):
            rc.WrF(inst,ia+4+4*a,map_center[a]-scale*local_center[a])
        for a in range(9): rc.WrF(inst,ia+16+4*a,scale if a in (0,4,8) else 0.0)
        sky_world_min,sky_world_max=rc.instance_aabb(inst,sky_inst,local_min,local_max)
        if sky_rec is not None:
            for a in range(3):
                rc.WrF(recs,80*sky_rec+4*a,sky_world_min[a])
                rc.WrF(recs,80*sky_rec+16+4*a,sky_world_max[a])
        sky_info.update({'applied_scale':scale,'center':map_center,'world_bounds':[sky_world_min,sky_world_max]})
        say(f'    Skybox: {scale:.3f}x ({sky_info["mode"]}), centered on imported map; no sky collision')
    if not preserve_fake_sky:
        say('    Skybox: NONE — donor Beaver Creek sky mesh disabled; native backdrop is game-controlled')
    # Stretch static culling trees over map + preserved sky so neither can be clipped by stale Beaver nodes.
    tree_mn=list(mn); tree_mx=list(mx)
    if preserve_fake_sky and sky_inst is not None:
        h=g.meshes[sky_mesh].hdr; bmin=[rc.F32(h,0),rc.F32(h,4),rc.F32(h,8)]; bmax=[rc.F32(h,12),rc.F32(h,16),rc.F32(h,20)]
        smn,smx=rc.instance_aabb(inst,sky_inst,bmin,bmax)
        for a in range(3): tree_mn[a]=min(tree_mn[a],smn[a]); tree_mx[a]=max(tree_mx[a],smx[a])
    _stretch_tree_bounds(ch.get('tree236').data,tree_mn,tree_mx)
    _stretch_tree_bounds(ch.get('tree192').data,tree_mn,tree_mx)
    g.vec24=bytearray()
    for x in mn+mx: rc.PutF(g.vec24,x)
    for a in range(3): rc.WrF(ch.header,940+4*a,mn[a]); rc.WrF(ch.header,952+4*a,mx[a])
    rc.WrF(ch.header,964,mn[1])

    say('    Collision-safe batching: up to 5,000 faces/front collision mesh; up to 12,000 faces/back render-only mesh')
    say(f'    Object-isolated meshes: {len(scene_groups)} logical group(s); GLB scene indices: {sorted(glb_indices)}')
    say('    GLB compatibility mode: only identified GLB assets are render-only; original scene geometry retains collision')
    say('    Collision isolation: per-object eligible triangle counts: '+repr({group:sum(O.tris for O in front_outs if O.scene_group==group) for group in sorted(scene_groups)}))
    say(f'    Reborn multi-batch: {len(materials)} materials -> {len(outs)} render mesh(es), {sum(len(o.batches) for o in outs)} material batches')
    if double_sided: say(f'    Double-sided export: {len(front_outs)} front mesh(es) + {len(back_outs)} reversed render-only mesh(es); collision stays on the front set only')
    if face_normal_repairs: say(f'    Auto-repaired {face_normal_repairs:,} face-local normal corner(s) on folded/missing-normal geometry')
    if near_collinear: say(f'    Skipped {near_collinear:,} numerically collinear triangle(s)')
    if float32_unsafe: say(f'    Skipped {float32_unsafe:,} triangles that invert/collapse when stored as Xbox float32 vertices')
    ninst_coll=rc.rebuild_collision(g,inst,has_coll)
    blocks=rc.parse_mopp_blocks(g.coll); coll_checked=0
    for k in collision_meshes:
        keys=rc.mopp_keys(blocks[k]['code']); tris=rc.mesh_triangles(g,k)
        if len(keys)!=len(tris): raise RuntimeError(f'Reborn MOPP validation failed on mesh {k}: {len(keys)} keys vs {len(tris)} triangles')
        coll_checked+=len(tris)
    rc.set_geometry(ch,g); raw=rc.write_chunk(ch)
    check=rc.read_chunk(raw); g2=rc.chunk_geometry(check)
    normal_alignment=_generic_normal_alignment(g2,our_meshes)
    if normal_alignment['negative']:
        if not _force_face_normals:
            say(f"    Post-write alignment found {normal_alignment['negative']} inverted triangles; retrying once with face-local normals")
            return build_bbchunk_multibatch(
                obj_path,reference_path,output_path,texture_mapping,map_name,
                alpha_mapping=alpha_mapping,surface_mapping=surface_mapping,
                world_scale=world_scale,minimap_name=minimap_name,log=log,
                report_path=report_path,mirror_x=mirror_x,flip_obj_v=flip_obj_v,
                double_sided=double_sided,sky_scale=sky_scale,
                preserve_fake_sky=preserve_fake_sky,_force_face_normals=True,render_only_scene_indices=render_only_scene_indices)
        raise RuntimeError(
            f"multi-batch normal/winding validation still found {normal_alignment['negative']} "
            "inverted triangles after face-local normal repair; "
            "check triangle-strip winding or degenerate source geometry")
    Path(output_path).write_bytes(raw)
    report={
        'format':'sr1-reborn-multibatch-v0.20','reference':str(reference_path),'output':str(output_path),'obj':str(obj_path),
        'obj_vertices':len(verts),'obj_triangles':len(faces),'materials':materials,'world_transform':transform,
        'bounds':[mn,mx],'frame_stats':frame_stats,'orientation':orientation,'normal_alignment':normal_alignment,
        'render':render,'render_meshes':[{'mesh':our_meshes[i],'side':('front' if i < front_mesh_count else 'back'),'collision':bool(i < front_mesh_count and O.scene_group==0),'triangles':O.tris,'vertices':O.verts,'indices':len(O.ib),'batches':len(O.batches),'bounds':[O.mn,O.mx]} for i,O in enumerate(outs)],
        'render_meshes_used':len(outs),'render_slots_used':len(outs),'render_triangles':sum(O.tris for O in outs),'source_triangles':sum(O.tris for O in front_outs),'material_batches':sum(len(O.batches) for O in outs),
        'object_isolated_meshes':True,'scene_groups':sorted(scene_groups),
        'imported_object_collision':'glb_only_render_only','render_only_scene_indices':sorted(glb_indices),'render_only_face_indices':len(excluded_face_ids),
        'double_sided':bool(double_sided),'front_render_meshes':len(front_outs),'back_render_meshes':len(back_outs),'collision_meshes':collision_meshes,
        'collision_triangles':coll_checked,'collision_expected_triangles':sum(O.tris for O in front_outs if O.scene_group==0),'collision_full_coverage':coll_checked==sum(O.tris for O in front_outs if O.scene_group==0),'collision_instances':ninst_coll,
        'sky_preserved':bool(preserve_fake_sky and sky_inst is not None),'sky':dict({'mesh':118,'instance':sky_inst if preserve_fake_sky else None,'record':sky_rec if preserve_fake_sky else None},**sky_info),'minimap_name':str(minimap_name) if minimap_name else None,
        'texture_items':tex_items,'material_ids':mat_ids,'old_materials':len(g.mats)-len(materials),'new_materials':len(g.mats),
        'old_strings':len(rc.chunk_strings(rc.read_chunk(Path(reference_path).read_bytes()))),'new_strings':len(rc.chunk_strings(check)),
        'uv_clipped':bool(clipped[0]),'degenerate_triangles_skipped':degenerate,'near_collinear_triangles_skipped':near_collinear,'float32_unsafe_triangles_skipped':float32_unsafe,'face_normal_corner_repairs':face_normal_repairs,
    }
    if report_path: Path(report_path).write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
    return report,obj
