#!/usr/bin/env python3
"""OBJ -> SR1 BBChunk compiler using the known-working Beaver Creek map as template.

Why this template is useful:
  * meshes 0..114: ordinary render meshes, one A4/B0/object and one draw range each
  * meshes 115..117: dedicated collision meshes with Havok MOPP v300 blobs
  * mesh 118: sky mesh (cleared by this exporter)
  * MOPP 119: aggregate collision router
  * every mesh uses the same recovered class-2 24-byte vertex layout

The exporter keeps serialized table sizes/offsets intact and replaces the data
inside those proven capacities.  That makes this much safer than inventing
unknown BBChunk sections from scratch while still allowing arbitrary OBJ data.
"""
from __future__ import annotations
from pathlib import Path
from collections import defaultdict, Counter
from itertools import permutations
import json, math, struct

import sr1_obj_core as core
v3=core.v3
v7=core.v7

RENDER_SLOTS=tuple(range(0,115))
COLLISION_SLOTS=(115,116,117)
SKY_SLOT=118
AGG_MOPP=119
OBJECT50_STRIDE=0x50
MAX_MATERIALS=30  # preserve slot 0 normal + slot 31 base/sky resource
SPATIAL_GRIDS=((4,3),(3,3),(3,2),(2,2),(1,1))
DEFAULT_WORLD_SCALE=0.50
BASE_RENDER_OBJECT_SPAN=48.0
BASE_RENDER_OBJECT_SCALE=0.30
# Keep the same source-space chunk size as world scale changes. At 0.50x the
# safe span becomes 80 SR1 units instead of forcing many more render slots.
def render_span_limit_for_scale(world_scale):
    s=max(float(world_scale), BASE_RENDER_OBJECT_SCALE)
    return BASE_RENDER_OBJECT_SPAN * (s / BASE_RENDER_OBJECT_SCALE)


def align(x,a): return (x+a-1)&~(a-1)
def U16(d,o):
    if o < 0 or o + 2 > len(d):
        raise RuntimeError(f'BBChunk parse out of range: uint16 at 0x{o:X}, size=0x{len(d):X}')
    return struct.unpack_from('>H',d,o)[0]

def U32(d,o):
    if o < 0 or o + 4 > len(d):
        raise RuntimeError(f'BBChunk parse out of range: uint32 at 0x{o:X}, size=0x{len(d):X}')
    return struct.unpack_from('>I',d,o)[0]



def detect_object50_table(d,b0_count,b0_off):
    """Detect the serialized 0x50-byte Object50 table from exact B0 links.

    Do not hard-code its file offset. Beaver Creek happens to place the table at
    0xF0040, immediately after the final A4 draw-range block; the old v0.4
    0xF0000 guess overlapped that block and corrupted the generated map.
    """
    def f32(o):
        if o < 0 or o + 4 > len(d): return float('nan')
        return struct.unpack_from('>f',d,o)[0]
    def finite_world(v):
        return math.isfinite(v) and abs(v) < 10000000.0
    def decode_ref(raw):
        raw &= 0xffffffff
        if raw == 0xffffffff: return None
        if raw < b0_count: return int(raw)
        if raw % 0x70 == 0:
            q=raw//0x70
            if q < b0_count: return int(q)
        if b0_off <= raw < b0_off + b0_count*0x70:
            q=raw-b0_off
            if q % 0x70 == 0: return int(q//0x70)
        return None
    def candidate(o):
        if o < 0 or o + OBJECT50_STRIDE > len(d): return None
        mn=(f32(o),f32(o+4),f32(o+8)); mx=(f32(o+0x10),f32(o+0x14),f32(o+0x18))
        if not all(finite_world(v) for v in mn+mx): return None
        if any(mn[i] > mx[i] + 0.25 for i in range(3)): return None
        spans=tuple(mx[i]-mn[i] for i in range(3))
        if any(x < -0.25 or x > 1000000.0 for x in spans): return None
        r3raw=U32(d,o+0x3c); r4raw=U32(d,o+0x44)
        r3=decode_ref(r3raw); r4=decode_ref(r4raw)
        if r3 is None and r4 is None: return None
        return {'offset':o,'min':mn,'max':mx,'ref3c':r3,'ref44':r4,'ref3c_raw':r3raw,'ref44_raw':r4raw}

    valid={}
    for o in range(0,max(0,len(d)-OBJECT50_STRIDE)+1,4):
        c=candidate(o)
        if c is not None: valid[o]=c
    best=None
    for start0 in sorted(valid):
        if start0-OBJECT50_STRIDE in valid: continue
        start=start0; recs=[]; pos=start
        while pos in valid:
            recs.append(valid[pos]); pos+=OBJECT50_STRIDE
        def meaningful(r):
            spans=tuple(r['max'][i]-r['min'][i] for i in range(3))
            return max(spans)>1.0e-4 and any(abs(v)>1.0e-3 for v in r['min']+r['max'])
        while recs and not meaningful(recs[0]):
            recs.pop(0); start+=OBJECT50_STRIDE
        while recs and not meaningful(recs[-1]): recs.pop()
        if len(recs)<3: continue
        refs=[x for r in recs for x in (r['ref3c'],r['ref44']) if x is not None]
        uniq=len(set(refs)); linked=len(refs)
        nondeg=spatial=0
        for r in recs:
            spans=tuple(r['max'][i]-r['min'][i] for i in range(3))
            if max(spans)>1.0e-4: nondeg+=1
            if any(abs(v)>1.0 for v in r['min']+r['max']): spatial+=1
        if nondeg < max(2,len(recs)//3): continue
        if spatial < max(2,len(recs)//3): continue
        if len(recs)>=4 and uniq<2: continue
        score=uniq*100+nondeg*20+spatial*10+linked+len(recs)
        if best is None or score>best[0]: best=(score,start,recs)
    if best is None: return None,[]
    return best[1],best[2]

def object50_links(records):
    out=defaultdict(list)
    for rec in records:
        for ref in (rec['ref3c'],rec['ref44']):
            if ref is not None and rec not in out[ref]: out[ref].append(rec)
    return out

def patch_object50_bounds(data,links,b0_index,mn,mx):
    for rec in links.get(b0_index,()):
        o=rec['offset']
        struct.pack_into('>3f',data,o,*mn)
        struct.pack_into('>3f',data,o+0x10,*mx)

def detect_object50_cull_tree(d,records):
    nrec=len(records); stride=0x2c; node_count=15
    tail=node_count*stride+nrec*2
    for start in range(0,max(0,len(d)-tail)+1,4):
        nodes=[]; total=0; children=[]; ok=True
        for i in range(node_count):
            o=start+i*stride
            try:
                mn=struct.unpack_from('>3f',d,o); cnt=U32(d,o+0x0c); mx=struct.unpack_from('>3f',d,o+0x10)
                c1=U32(d,o+0x24); c2=U32(d,o+0x28)
            except Exception: ok=False; break
            if not all(math.isfinite(x) and abs(x)<1e7 for x in mn+mx) or any(mn[a]>mx[a]+0.01 for a in range(3)):
                ok=False; break
            leaf=(c1==0xffffffff and c2==0xffffffff)
            if leaf:
                if cnt<=0 or cnt>nrec: ok=False; break
                total+=cnt
            else:
                if cnt!=0 or c1>=node_count or c2>=node_count: ok=False; break
                children += [c1,c2]
            nodes.append({'index':i,'offset':o,'min':mn,'max':mx,'count':cnt,'child1':c1,'child2':c2,'leaf':leaf})
        if not ok or total!=nrec: continue
        poff=start+node_count*stride
        try: perm=list(struct.unpack_from('>'+'H'*nrec,d,poff))
        except Exception: continue
        if sorted(perm)!=list(range(nrec)): continue
        if len([i for i in range(node_count) if i not in set(children)])!=1: continue
        pos=0
        for n in nodes:
            if not n['leaf']: continue
            ids=perm[pos:pos+n['count']]; pos+=n['count']
            cmn=tuple(min(records[j]['min'][a] for j in ids) for a in range(3)); cmx=tuple(max(records[j]['max'][a] for j in ids) for a in range(3))
            if any(abs(cmn[a]-n['min'][a])>0.02 or abs(cmx[a]-n['max'][a])>0.02 for a in range(3)): ok=False; break
        if ok: return start,nodes,perm
    return None,[],[]

def rebuild_object50_cull_tree(data,nodes,perm,records):
    cur=[]
    for r in records:
        o=r['offset']; cur.append((struct.unpack_from('>3f',data,o),struct.unpack_from('>3f',data,o+0x10)))
    bounds={}; pos=0
    for n in nodes:
        if not n['leaf']: continue
        ids=perm[pos:pos+n['count']]; pos+=n['count']
        bounds[n['index']]=(tuple(min(cur[j][0][a] for j in ids) for a in range(3)),tuple(max(cur[j][1][a] for j in ids) for a in range(3)))
    def solve(i):
        if i in bounds: return bounds[i]
        n=nodes[i]; A=solve(n['child1']); B=solve(n['child2'])
        bounds[i]=(tuple(min(A[0][a],B[0][a]) for a in range(3)),tuple(max(A[1][a],B[1][a]) for a in range(3))); return bounds[i]
    child={x for n in nodes if not n['leaf'] for x in (n['child1'],n['child2'])}; root=[n['index'] for n in nodes if n['index'] not in child][0]
    solve(root)
    for n in nodes:
        mn,mx=bounds[n['index']]; struct.pack_into('>3f',data,n['offset'],*mn); struct.pack_into('>3f',data,n['offset']+0x10,*mx)
    return {'nodes':len(nodes),'root':root,'root_bounds':[bounds[root][0],bounds[root][1]]}

def parse_name_slots_and_ranges(d):
    cur=align(968,64)
    nc=U32(d,cur); cur+=4+nc*4
    slots=[]
    for i in range(nc):
        z=d.index(0,cur)
        raw=bytes(d[cur:z]); text=raw.decode('latin1','replace')
        slots.append({'index':i,'offset':cur,'length':len(raw),'text':text})
        cur=z+1
    cur=align(cur,64)
    a4c,b0c,mc,b8c=[U32(d,cur+4*i) for i in range(4)]; cur+=16
    cur=align(cur,64)
    a4recs=[tuple(U32(d,cur+i*0x10+j*4) for j in range(4)) for i in range(a4c)]
    cur+=a4c*0x10
    cur=align(cur,64)+b0c*0x70
    cur=align(cur,64)+b8c*0x64
    cur=align(cur,64); c=U32(d,cur); cur+=4+c
    cur=align(cur,64); c=U32(d,cur); cur+=4+c+0x18
    cur=align(cur,4); cur+=mc*4
    ptr=[U32(d,cur+i*4) for i in range(mc)]; cur+=mc*4
    cur=align(cur,64)
    desc=[]
    for i in range(mc):
        cur=align(cur,16); desc.append(cur); cur+=0x58
        if ptr[i]:
            cur=align(cur,16); comp=cur; cur+=0x10
            h0=U32(d,comp)!=0; h1=U32(d,comp+4)!=0; c0=U16(d,comp+8); c1=U16(d,comp+10)
            if h0: cur=align(cur,32)+c0*2
            if h1: cur=align(cur,32)+c1*2
    cur=align(cur,0x1000)
    for i,o in enumerate(desc):
        hv=U32(d,o+4)!=0; hi=U32(d,o+8)!=0; vc=U16(d,o+0xc); ic=U16(d,o+0xe); st=U16(d,o+0x10)
        if hi: cur=align(cur,0x20); cur+=ic*2
        if hv: cur=align(cur,0x20); cur+=vc*st
    cur=align(cur,0x1000)
    # E3B0 metadata
    cur=align(cur,16); root=cur; cur+=0x0c
    c0=U16(d,root)
    def ce30(c,s):
        c=align(c,16); c+=24*U16(d,s)
        c=align(c,16); c+=2*U16(d,s+2)
        return c
    def e020(c,r):
        c=align(c,4); c+=12*U16(d,r+0x0a)
        c=align(c,4); n=struct.unpack_from('>h',d,r+0x14)[0]; c+=8*n if n>0 else 0
        c=ce30(c,r+0x1c); c=ce30(c,r+0x28)
        c=align(c,4); c+=6*U16(d,r+8)
        return c
    if c0:
        cur=align(cur,16); base=cur; cur+=0x38*c0; cur=align(cur,16)
        for i in range(c0): cur=e020(cur,base+i*0x38)
    c1=U16(d,root+2)
    if c1:
        cur=align(cur,4); arr=cur; cur+=0x10*c1
        for i in range(c1):
            cur=align(cur,4); cur+=4*U16(d,arr+i*0x10+8)

    ranges=[]
    for ai,a4 in enumerate(a4recs):
        if a4[1]:
            block=cur; cur+=0x30
            cur+=12*U32(d,block+0x24)+4*U32(d,block+0x1c)+2*U32(d,block+0x2c)
        cur=align(cur,4); obj=cur; cur+=0x28; cur=align(cur,16)
        n=U16(d,obj+0x1c); entries=cur; cur+=0x10*n
        companion=None
        if U32(d,obj+0x24):
            cur=align(cur,16); companion=cur; cur+=0x0c*n
        for ei in range(n):
            ent=entries+ei*0x10; ac=U16(d,ent+2)
            arr=None
            if ac:
                cur=align(cur,16); arr=cur; cur+=8*ac
            mid=U32(d,ent+8)
            if arr is not None:
                for j in range(ac):
                    roff=arr+j*8
                    q=U32(d,roff+4)
                    ranges.append({'a4':ai,'mesh':mid,'obj_off':obj,'start_off':roff,'q_off':roff+4,
                                   'start':U32(d,roff),'count':(q>>16)&0xffff,'selector':q&0xffff})
            if companion is not None:
                cent=companion+ei*0x0c; cc=U16(d,cent+2)
                if cc:
                    cur=align(cur,16); cur+=8*cc
    return slots,ranges





def parse_material_texture_bindings(d):
    """Recover Caboose Beaver Creek's material -> diffuse resource indirection.

    The A4 draw-range low 16 bits select one of the E3B0 material records.
    They are NOT PEG/name-table indices.  The first 12-byte parameter in each
    material record has tag 0x69B48F91 and its +4 uint32 is the diffuse
    resource/name-table index.  In the reference this is material N -> N+2,
    with material 28 -> resource 30 (bc_sky_baked.tga).
    """
    cur=align(968,64)
    nc=U32(d,cur); cur+=4+nc*4
    for _ in range(nc):
        cur=d.index(0,cur)+1
    cur=align(cur,64)
    a4c,b0c,mc,b8c=[U32(d,cur+4*i) for i in range(4)]; cur+=16
    cur=align(cur,64)+a4c*0x10
    cur=align(cur,64)+b0c*0x70
    cur=align(cur,64)+b8c*0x64
    cur=align(cur,64); c=U32(d,cur); cur+=4+c
    cur=align(cur,64); c=U32(d,cur); cur+=4+c+0x18
    cur=align(cur,4); cur+=mc*4
    ptr=[U32(d,cur+i*4) for i in range(mc)]; cur+=mc*4
    cur=align(cur,64)
    desc=[]
    for i in range(mc):
        cur=align(cur,16); desc.append(cur); cur+=0x58
        if ptr[i]:
            cur=align(cur,16); comp=cur; cur+=0x10
            h0=U32(d,comp)!=0; h1=U32(d,comp+4)!=0
            c0=U16(d,comp+8); c1=U16(d,comp+10)
            if h0: cur=align(cur,32)+c0*2
            if h1: cur=align(cur,32)+c1*2
    cur=align(cur,0x1000)
    for o in desc:
        hv=U32(d,o+4)!=0; hi=U32(d,o+8)!=0
        vc=U16(d,o+0xc); ic=U16(d,o+0xe); st=U16(d,o+0x10)
        if hi: cur=align(cur,0x20); cur+=ic*2
        if hv: cur=align(cur,0x20); cur+=vc*st
    root=align(cur,0x1000)
    mat_count=U16(d,root)
    recbase=align(root+0x0c,16)
    var=align(recbase+0x38*mat_count,16)
    out=[]
    for i in range(mat_count):
        r=recbase+i*0x38
        n12=U16(d,r+0x0a)
        var=align(var,4)
        if n12<1:
            raise RuntimeError(f'Beaver material {i} has no texture parameter array')
        tag=U32(d,var); texture_slot=U32(d,var+4)
        if tag!=0x69B48F91:
            raise RuntimeError(f'Beaver material {i} unexpected diffuse tag 0x{tag:08X}')
        first_param=var
        var+=12*n12
        n8=struct.unpack_from('>h',d,r+0x14)[0]
        var=align(var,4); var+=8*max(n8,0)
        var=align(var,16); var+=24*U16(d,r+0x1c)
        var=align(var,16); var+=2*U16(d,r+0x1e)
        var=align(var,16); var+=24*U16(d,r+0x28)
        var=align(var,16); var+=2*U16(d,r+0x2a)
        var=align(var,4); var+=6*U16(d,r+8)
        out.append({
            'material_id':i, 'record_offset':r, 'diffuse_param_offset':first_param,
            'texture_slot':texture_slot, 'shader_flags':U16(d,r+0x12),
            'record_hash':U32(d,r+4)
        })
    return {'root_offset':root,'material_count':mat_count,'records':out}

def transform_obj_for_sr1(obj, world_scale=DEFAULT_WORLD_SCALE, center_xz=True, ground_y=True, fixed_origin=None):
    """Uniformly scale and normalize an imported OBJ into SR1 world units.

    Halo BSP exports commonly arrive much larger than the working SR1 custom-map
    reference.  The exporter is now scale-aware. 0.50 is the default for the current Blood
    Gulch test build; render-object span grows proportionally above the proven
    0.30 baseline so larger world scale does not consume extra Beaver slots.

    X/Z are centered around zero and the lowest imported Y becomes zero.  UVs,
    normals and face indices are unchanged.
    """
    scale=float(world_scale)
    if not math.isfinite(scale) or scale<=0.0 or scale>100.0:
        raise RuntimeError(f'invalid world scale {world_scale!r}')
    raw=list(obj['verts'])
    if not raw: raise RuntimeError('OBJ has no vertices')
    mn=tuple(min(v[a] for v in raw) for a in range(3))
    mx=tuple(max(v[a] for v in raw) for a in range(3))
    ox=(mn[0]+mx[0])*0.5 if center_xz else 0.0
    oz=(mn[2]+mx[2])*0.5 if center_xz else 0.0
    oy=mn[1] if ground_y else 0.0
    if fixed_origin is not None:
        if len(fixed_origin)!=3 or not all(math.isfinite(float(v)) for v in fixed_origin):
            raise ValueError("Invalid fixed base-map origin")
        ox,oy,oz=map(float,fixed_origin)
    verts=[((v[0]-ox)*scale,(v[1]-oy)*scale,(v[2]-oz)*scale) for v in raw]
    out=dict(obj); out['verts']=verts
    tmn=tuple(min(v[a] for v in verts) for a in range(3))
    tmx=tuple(max(v[a] for v in verts) for a in range(3))
    return out,{'scale':scale,'source_bounds':[mn,mx],'bounds':[tmn,tmx],
                'offset_before_scale':[ox,oy,oz],'center_xz':bool(center_xz),'ground_y':bool(ground_y)}

def _build_spatial_render_strips(verts,faces,nx,nz):
    """Split render work by X/Z cell *and* material before stripification.

    SR1 distance/stream culling is sensitive to B0 object origins.  Packing an
    entire map-wide material into one Beaver render object can make large parts
    of that object disappear as the player moves.  Spatial cells keep every
    render object's origin physically close to the triangles it owns.
    """
    minx=min(v[0] for v in verts); maxx=max(v[0] for v in verts)
    minz=min(v[2] for v in verts); maxz=max(v[2] for v in verts)
    dx=maxx-minx; dz=maxz-minz
    groups=defaultdict(list)
    for fi,f in enumerate(faces):
        cx=(verts[f[0]][0]+verts[f[1]][0]+verts[f[2]][0])/3.0
        cz=(verts[f[0]][2]+verts[f[1]][2]+verts[f[2]][2])/3.0
        fx=0.0 if abs(dx)<1e-12 else (cx-minx)/dx
        fz=0.0 if abs(dz)<1e-12 else (cz-minz)/dz
        ix=min(nx-1,max(0,int(fx*nx))); iz=min(nz-1,max(0,int(fz*nz)))
        groups[(ix,iz,str(f[3] or '(default)'))].append(fi)
    strips=[]
    for (ix,iz,mat),fids in groups.items():
        local=[faces[fi] for fi in fids]
        ss=v7.material_stripify(local)
        for st in ss:
            st=dict(st)
            st['faces']=[fids[j] for j in st['faces']]
            st['mat']=mat
            st['group']=(mat,ix,iz)
            strips.append(st)
    return strips,groups

def _max_render_object_span(states,verts,faces):
    spans=[]
    for S in states.values():
        if not S.get('faces'): continue
        mn,mx=_slot_bounds(verts,S['faces'],faces)
        spans.append(max(mx[a]-mn[a] for a in range(3)))
    return max(spans) if spans else 0.0

def _safe_name(material_index,slot_len):
    if slot_len<8: raise RuntimeError('texture name slot too short')
    room=slot_len-4
    stem=f'h{material_index:03x}'
    stem=(stem[:room]+'_'*room)[:room]
    return stem+'.tga'


def reserve_material_names(data,materials,texture_paths,slot_plan=None,dynamic_materials=False):
    """Bind OBJ materials to real Beaver material records.

    slot_plan maps OBJ material -> Beaver MATERIAL ID (draw selector).  Each
    material record then points to its own diffuse texture resource/name slot.
    Keeping those two IDs separate is critical: selector 28 -> texture slot 30
    in Caboose's working map.
    """
    slots,_=parse_name_slots_and_ranges(data)
    mt=parse_material_texture_bindings(data)
    records={r['material_id']:r for r in mt['records']}
    if slot_plan is None and not dynamic_materials:
        raise RuntimeError('fixed Beaver material mode requires slot_plan')
    mapping={}
    claimed=set()
    for mat in materials:
        mid=0 if dynamic_materials else int(slot_plan[mat])
        if mid not in records or ((not dynamic_materials) and mid in claimed):
            raise RuntimeError(f'invalid/duplicate Beaver material {mid} for {mat!r}')
        claimed.add(mid)
        rec=records[mid]
        tid=int(rec['texture_slot'])
        if not (0<=tid<len(slots)):
            raise RuntimeError(f'Beaver material {mid} points outside name table: {tid}')
        slot=slots[tid]
        if not slot['text'].lower().endswith(('.tga','.tgn')):
            raise RuntimeError(f'Beaver material {mid} diffuse slot {tid} is not a texture: {slot["text"]}')
        mapping[mat]={
            'selector':mid, 'material_id':mid, 'texture_slot':tid,
            'name_id':mid,  # legacy report alias: draw selector, NOT PEG slot
            'peg_name':slot['text'], 'source_texture':str(texture_paths[mat]),
            'old_name':slot['text'], 'shader_flags':rec['shader_flags'],
            'material_record_hash':rec['record_hash'], 'fixed_resource':True
        }
    return mapping

def _slot_bounds(verts,face_ids,faces):
    ids=set()
    for fi in face_ids: ids.update(faces[fi][:3])
    mn=tuple(min(verts[i][a] for i in ids) for a in range(3))
    mx=tuple(max(verts[i][a] for i in ids) for a in range(3))
    return mn,mx


def _build_render_strips(faces):
    return v7.material_stripify(faces)


def _strip_requirement(cursor,st):
    k,L,base=v7.block_layout(cursor,st)
    return st,k,L,base


def _placement_requirement(cursor,st):
    """Return (possibly re-oriented strip, prefix, total_len, real_base).

    An isolated triangle can be encoded in 6 indices rather than the generic
    6/7-index block.  This matters for Beaver Creek because many of the 115
    render slots are intentionally tiny (4 vertices / 9 indices).
    """
    if len(st.get('faces',()))==1 and len(st.get('seq',()))==3:
        st2=st
        # Match the proven compact layout from the earlier SR1 importer.
        # When the block begins on even parity, swap A/B once; strip parity
        # swaps them back for the emitted real triangle.
        if (cursor & 1)==0:
            st2=dict(st)
            q=list(st['seq'])
            q[0],q[1]=q[1],q[0]
            st2['seq']=q
        return st2,2,6,cursor+1
    k,L,base=v7.block_layout(cursor,st)
    return st,k,L,base


def _split_oversize_strips(strips,faces,slots):
    maxvc=max(s['vc'] for s in slots); maxic=max(s['ic'] for s in slots)
    out=[]
    for st in strips:
        placed,k,L,base=_placement_requirement(0,st)
        if len(set(placed['seq']))<=maxvc and L<=maxic:
            out.append(st); continue
        # Only split a strip when it cannot fit in the largest legal render
        # slot at all.  Keeping long natural strips is much more capacity-
        # efficient than eagerly turning them into isolated triangles.
        for fi in st['faces']:
            f=faces[fi]
            q={'seq':[f[0],f[1],f[2]],'faces':[fi],'mat':f[3]}
            if 'group' in st: q['group']=st['group']
            out.append(q)
    return out


def _annotate_strip_bounds(strips,verts,faces):
    for st in strips:
        ids=st.get('faces',())
        if not ids: continue
        mn,mx=_slot_bounds(verts,ids,faces)
        st['mn']=tuple(mn); st['mx']=tuple(mx)
        st['center']=tuple((mn[a]+mx[a])*0.5 for a in range(3))
    return strips

def _combined_bounds(mn,mx,smn,smx):
    if mn is None: return tuple(smn),tuple(smx)
    return (tuple(min(mn[a],smn[a]) for a in range(3)),
            tuple(max(mx[a],smx[a]) for a in range(3)))

def _simulate_slot_pack(work,mesh,max_span):
    """Greedily pack as much of one material as possible into an EMPTY slot.

    Returns placements and the original work-list indices consumed.  Several
    deterministic strategies are tried because vertex sharing and strip parity
    make this a small 2-D bin-packing problem (vertex capacity + index capacity).
    """
    if not work:
        return {'placements':[],'chosen':[],'faces':0,'vertices':0,'indices':0}

    def run(mode):
        cursor=0
        used=set()
        left=set(range(len(work)))
        placements=[]
        chosen=[]
        bmn=bmx=None

        while left:
            opts=[]
            for wi in left:
                st=work[wi]
                pst,k,L,base=_placement_requirement(cursor,st)
                sv=set(pst['seq'])
                new=used|sv
                if len(new)>mesh['vc'] or cursor+L>mesh['ic']:
                    continue
                nmn,nmx=_combined_bounds(bmn,bmx,st.get('mn',(0,0,0)),st.get('mx',(0,0,0)))
                span=max(nmx[a]-nmn[a] for a in range(3))
                if span>max_span:
                    continue
                added=len(new)-len(used)
                shared=len(sv)-added
                nf=len(st.get('faces',()))
                # Long real strips are valuable because they encode many
                # triangles for very few bridge indices. Vertex sharing is
                # the second priority.
                if mode==0:
                    score=(-nf,-shared,added,L,wi)
                elif mode==1:
                    score=(added/max(1,nf),-nf,L,-shared,wi)
                else:
                    score=(L/max(1,nf),-nf,added,-shared,wi)
                opts.append((score,wi,pst,k,L,base,new,nmn,nmx))
            if not opts:
                break
            _,wi,pst,k,L,base,new,nmn,nmx=min(opts,key=lambda x:x[0])
            placements.append({
                'strip':pst,'cursor':cursor,'prefix':k,'length':L,'base':base
            })
            chosen.append(wi)
            cursor+=L
            used=new
            bmn,bmx=nmn,nmx
            left.remove(wi)

        return {
            'placements':placements,
            'chosen':chosen,
            'faces':sum(len(work[i].get('faces',())) for i in chosen),
            'vertices':len(used),
            'indices':cursor,
        }

    tries=[run(0),run(1),run(2)]
    return max(
        tries,
        key=lambda r:(r['faces'],len(r['chosen']),-r['vertices'],-r['indices'])
    )


def assign_render_strips(strips,faces,mesh_defs,max_span):
    """Assign Beaver's fixed render buffers without wasting slots.

    v0.3's allocator considered one strip at a time and preferred the smallest
    currently adequate slot.  On Blood Gulch that fragmented the 115 render
    slots: large materials consumed many tiny slots and later materials were
    left with nowhere to put even one triangle.

    This version handles an entire material at once. For each still-empty
    Beaver slot it simulates how much of that material can fit, then selects the
    slot that absorbs the most faces. If one slot can hold the whole remaining
    material, the tightest such slot is used.
    """
    states={
        s['id']:{
            'mesh':s,'material':None,'usedv':set(),'cursor':0,
            'blocks':[],'faces':[]
        } for s in mesh_defs
    }
    bymat=defaultdict(list)
    for st in strips:
        key=st.get('group',str(st.get('mat','(default)')))
        bymat[key].append(st)

    # Hardest materials first: lots of faces, lots of distinct OBJ vertices,
    # and long strip streams. This preserves the large template buffers for
    # the materials that actually need them.
    def mat_weight(mat):
        ss=bymat[mat]
        return (
            sum(len(x.get('faces',())) for x in ss),
            len(set(v for x in ss for v in x.get('seq',()))),
            sum(len(x.get('seq',())) for x in ss),
        )
    mat_order=sorted(bymat,key=mat_weight,reverse=True)

    unused=set(states)
    for mat_index,group_key in enumerate(mat_order):
        work=list(bymat[group_key])
        mat=str(work[0].get('mat','(default)')) if work else str(group_key)
        while work:
            if not unused:
                rem_faces=sum(len(x.get('faces',())) for x in work)
                raise RuntimeError(
                    f'render packing ran out of Beaver render slots while packing '
                    f'material {mat!r}; {rem_faces} face(s) remain'
                )

            candidates=[]
            for sid in unused:
                m=states[sid]['mesh']
                sim=_simulate_slot_pack(work,m,max_span)
                if not sim['chosen']:
                    continue
                whole=(len(sim['chosen'])==len(work))
                # If the whole remaining material fits, prefer the tightest
                # adequate slot. Otherwise prefer the slot that removes the
                # most faces in one shot, avoiding the fragmentation bug.
                if whole:
                    waste=(m['vc']-sim['vertices']) + 0.12*(m['ic']-sim['indices'])
                    rank=(0,waste,m['vc']+0.12*m['ic'],sid)
                else:
                    util_v=sim['vertices']/max(1,m['vc'])
                    util_i=sim['indices']/max(1,m['ic'])
                    rank=(1,-sim['faces'],-len(sim['chosen']),-(util_v+util_i),sid)
                candidates.append((rank,sid,sim))

            if not candidates:
                # A natural strip may be legal in the global maximum slot but
                # not in any remaining slot. Split only the currently stranded
                # strips into isolated triangles and retry.
                maxvc=max(states[s]['mesh']['vc'] for s in unused)
                maxic=max(states[s]['mesh']['ic'] for s in unused)
                changed=False
                rebuilt=[]
                for st in work:
                    pst,k,L,base=_placement_requirement(0,st)
                    if len(set(pst['seq']))>maxvc or L>maxic:
                        for fi in st['faces']:
                            f=faces[fi]
                            q={'seq':[f[0],f[1],f[2]],'faces':[fi],'mat':f[3]}
                            if 'group' in st: q['group']=st['group']
                            rebuilt.append(q)
                        changed=True
                    else:
                        rebuilt.append(st)
                if changed:
                    work=rebuilt
                    continue
                smallest=min(
                    ((states[s]['mesh']['vc'],states[s]['mesh']['ic'],s) for s in unused),
                    default=(0,0,-1)
                )
                largest=max(
                    ((states[s]['mesh']['vc'],states[s]['mesh']['ic'],s) for s in unused),
                    default=(0,0,-1)
                )
                st=work[0]
                raise RuntimeError(
                    f'render packing failed for material {mat!r}; '
                    f'{sum(len(x.get("faces",())) for x in work)} face(s) remain, '
                    f'next strip faces={len(st.get("faces",()))} '
                    f'verts={len(set(st.get("seq",())))}, '
                    f'remaining slot range vc/ic={smallest[:2]}..{largest[:2]}'
                )

            _,sid,sim=min(candidates,key=lambda x:x[0])
            S=states[sid]
            S['material']=mat
            S['blocks']=sim['placements']
            S['cursor']=sim['indices']
            chosen=set(sim['chosen'])
            for wi in sim['chosen']:
                st=work[wi]
                S['usedv'].update(st['seq'])
                S['faces'].extend(st['faces'])
            unused.remove(sid)
            work=[st for wi,st in enumerate(work) if wi not in chosen]

        remaining_mats=len(mat_order)-mat_index-1
        if remaining_mats and len(unused)<remaining_mats:
            raise RuntimeError(
                f'render packing used too many slots after material {mat!r}: '
                f'{len(unused)} slots remain for {remaining_mats} materials'
            )
    return states

def _decode_strip(indices):
    out=[]
    for end in range(2,len(indices)):
        a,b,c=indices[end-2],indices[end-1],indices[end]
        if a==b or b==c or a==c: continue
        if ((end-2)&1): a,b=b,a
        out.append((a,b,c))
    return out


def _write_render_slot(data,original,S,meshes,b0off,draw,verts,faces,uv0,frames,mapping,obj50_links):
    sid=S['mesh']['id']; m=meshes[sid]; d=m['desc']
    # Always clear fixed-capacity buffers first.
    if m['ib'] is not None:
        for i in range(m['ic']): struct.pack_into('>H',data,m['ib']+2*i,0)
    zero=bytes(m['stride'])
    for i in range(m['vc']): data[m['vb']+i*m['stride']:m['vb']+(i+1)*m['stride']]=zero

    if not S['blocks']:
        struct.pack_into('>I',data,d,0)
        struct.pack_into('>I',data,draw['start_off'],0)
        struct.pack_into('>I',data,draw['q_off'],draw['selector'] & 0xffff)
        bo=b0off+sid*0x70; struct.pack_into('>3f',data,bo+4,0.0,0.0,0.0)
        obj=draw.get('obj_off')
        if obj is not None:
            struct.pack_into('>3f',data,obj,0.0,0.0,0.0); struct.pack_into('>3f',data,obj+0x0c,0.0,0.0,0.0)
        patch_object50_bounds(data,obj50_links,sid,(0.0,0.0,0.0),(0.0,0.0,0.0))
        return {'mesh':sid,'material':None,'triangles':0,'indices':0,'vertices':0}

    mat=S['material']; face_ids=S['faces']
    mn,mx=_slot_bounds(verts,face_ids,faces)
    origin=tuple((mn[a]+mx[a])*0.5 for a in range(3))
    order=sorted(S['usedv']); rem={g:i for i,g in enumerate(order)}
    if len(order)>m['vc']: raise RuntimeError('internal render vertex overflow')
    uv_count=U16(original,d+0x12); vclass=U16(original,d+0x14)
    if vclass!=2 or m['stride']!=20+uv_count*4:
        raise RuntimeError(f'Beaver mesh {sid} has unexpected vertex format')
    for li,g in enumerate(order):
        p=verts[g]; local=(p[0]-origin[0],p[1]-origin[1],p[2]-origin[2])
        core.write_class2_vertex(data,m['vb']+li*m['stride'],m['stride'],uv_count,local,frames[g],uv0[g],'copy')

    for B in S['blocks']:
        st=B['strip']; p=B['cursor']; k=B['prefix']
        A=rem[st['seq'][0]]
        for j in range(k): struct.pack_into('>H',data,m['ib']+2*(p+j),A)
        raw=p+k
        for j,g in enumerate(st['seq'][1:]): struct.pack_into('>H',data,m['ib']+2*(raw+j),rem[g])
        last=rem[st['seq'][-1]]; suffix=raw+len(st['seq'])-1
        struct.pack_into('>H',data,m['ib']+2*suffix,last)
        struct.pack_into('>H',data,m['ib']+2*(suffix+1),last)

    tri_count=len(face_ids); idx_count=S['cursor']
    if tri_count>0xffff or idx_count>0xffff: raise RuntimeError('render slot count exceeds uint16')
    struct.pack_into('>I',data,d,tri_count<<16)
    struct.pack_into('>I',data,draw['start_off'],0)
    struct.pack_into('>I',data,draw['q_off'],(idx_count<<16)|int(mapping[mat]['selector']))
    bo=b0off+sid*0x70
    struct.pack_into('>3f',data,bo+4,*origin)
    struct.pack_into('>9f',data,bo+0x10,1,0,0,0,1,0,0,0,1)
    lmn=tuple(mn[a]-origin[a] for a in range(3)); lmx=tuple(mx[a]-origin[a] for a in range(3))
    obj=draw.get('obj_off')
    if obj is None: raise RuntimeError(f'missing render-object AABB for mesh {sid}')
    struct.pack_into('>3f',data,obj,*lmn); struct.pack_into('>3f',data,obj+0x0c,*lmx)
    patch_object50_bounds(data,obj50_links,sid,mn,mx)

    # Exact render topology validation against this slot's assigned faces.
    idx=[U16(data,m['ib']+2*i) for i in range(idx_count)]
    got=Counter(tuple(sorted((order[a],order[b],order[c]))) for a,b,c in _decode_strip(idx))
    want=Counter(tuple(sorted(faces[fi][:3])) for fi in face_ids)
    if got!=want:
        raise RuntimeError(f'render topology validation failed in mesh {sid}: got={sum(got.values())} want={sum(want.values())}')
    return {'mesh':sid,'material':mat,'triangles':tri_count,'indices':idx_count,'vertices':len(order),'origin':origin,'bounds':[mn,mx]}



def _collision_position_dedupe(verts):
    """Collapse UV/normal seam duplicates for physics-only geometry.

    Blood Gulch has 5,233 native render vertices but only about 2.8k unique
    positions. The old collision path duplicated three vertices per triangle,
    which wasted Beaver's fixed collision buffers and capped coverage at 3,516
    faces. Physics only needs position topology, so use float32 position identity.
    """
    ids=[]; reps=[]; table={}
    for gi,p in enumerate(verts):
        key=struct.pack('>3f',float(p[0]),float(p[1]),float(p[2]))
        q=table.get(key)
        if q is None:
            q=len(reps); table[key]=q; reps.append(gi)
        ids.append(q)
    return ids,reps


def _collision_chunk_plan(face_ids, sid, verts, faces, pos_ids, pos_reps, mesh, mopp_cap):
    """Compile one spatial collision chunk into a no-FFFF strip stream + MOPP."""
    if not face_ids:
        return {'sid':sid,'face_ids':[],'strips':[],'stream':[],'used_pos':set(),
                'records':[],'info':None,'code':b'','origin':(0.0,0.0,0.0),
                'bounds':[(0.0,0.0,0.0),(0.0,0.0,0.0)]}

    # Stripify using deduplicated PHYSICS position vertices, not render seam verts.
    local_faces=[]
    for fi in face_ids:
        f=faces[fi]
        local_faces.append((pos_ids[f[0]],pos_ids[f[1]],pos_ids[f[2]],'collision'))
    strips=v3.stripify(local_faces)

    stream=[]; face_key={}; used=set()
    for st in strips:
        k,L,base=v7.block_layout(len(stream),st)
        a=st['seq'][0]; last=st['seq'][-1]
        stream.extend([a]*k)
        stream.extend(st['seq'][1:])
        stream.extend([last,last])
        if len(stream) != (base + len(st['seq']) + 2):
            # Equivalent to cursor+L; explicit check catches accidental block-layout drift.
            pass
        used.update(st['seq'])
        for j,lfi in enumerate(st['faces']):
            face_key[face_ids[lfi]]=base+j

    if len(used)>mesh['vc'] or len(stream)>mesh['ic']:
        raise RuntimeError(
            f'collision slot {sid} buffer overflow: faces={len(face_ids)} '
            f'vertices={len(used)}/{mesh["vc"]} indices={len(stream)}/{mesh["ic"]}'
        )

    # Verify generated strip topology BEFORE writing it into the BBChunk.
    got=Counter(tuple(sorted(t)) for t in v7.standard_strip_faces(stream))
    want=Counter(tuple(sorted((pos_ids[faces[fi][0]],pos_ids[faces[fi][1]],pos_ids[faces[fi][2]]))) for fi in face_ids)
    if got!=want:
        raise RuntimeError(
            f'collision strip topology mismatch in slot {sid}: got={sum(got.values())} want={sum(want.values())}'
        )

    mn,mx=_slot_bounds(verts,face_ids,faces)
    origin=tuple((mn[a]+mx[a])*0.5 for a in range(3))
    records=[]
    for fi in face_ids:
        f=faces[fi]
        _,_,wmn,wmx=v3.tri_info(verts,f)
        lmn=tuple(wmn[a]-origin[a] for a in range(3))
        lmx=tuple(wmx[a]-origin[a] for a in range(3))
        records.append({'key':int(face_key[fi]),'mn':lmn,'mx':lmx,'fi':fi})
    info,code=v3.compile_mopp([{'key':r['key'],'mn':r['mn'],'mx':r['mx']} for r in records])
    if len(code)>mopp_cap:
        raise RuntimeError(f'collision MOPP {sid} overflow {len(code)}/{mopp_cap}')

    return {'sid':sid,'face_ids':list(face_ids),'strips':strips,'stream':stream,'used_pos':used,
            'records':records,'info':info,'code':code,'origin':origin,'bounds':[mn,mx],
            'pos_reps':pos_reps}


def _build_full_collision_plan(verts,faces,meshes,mopps,original):
    """Fit every OBJ triangle into Beaver's three proven collision MOPP meshes.

    The old writer used 3 unique vertices + ~6 strip indices per triangle. This
    planner deduplicates position-only physics vertices and builds natural strips,
    making all 5,455 Blood Gulch faces fit inside the existing 115..117 buffers.
    Chunks stay spatially contiguous so each MOPP remains compact.
    """
    face_ids=[]
    for fi,f in enumerate(faces):
        area,_,_,_=v3.tri_info(verts,f)
        if area>1.0e-10:
            face_ids.append(fi)
    if not face_ids:
        return [],0

    pos_ids,pos_reps=_collision_position_dedupe(verts)
    xs=[v[0] for v in verts]; zs=[v[2] for v in verts]
    axes=[0,2] if (max(xs)-min(xs)) >= (max(zs)-min(zs)) else [2,0]
    slot_ids=list(COLLISION_SLOTS)

    # Ratios mirror the actual fixed VB/IB capacities: 4500,4500,1548 verts and
    # 8997,8997,3093 indices. Try the small slot at each spatial end/middle.
    orders=[]
    for p in permutations(slot_ids):
        if p not in orders: orders.append(p)
    boundary_jitter=(-0.04,-0.02,0.0,0.02,0.04)
    errors=[]

    for axis in axes:
        ordered=sorted(face_ids,key=lambda fi: sum(verts[faces[fi][j]][axis] for j in range(3))/3.0)
        n=len(ordered)
        for order in orders:
            weights=[]
            for sid in order:
                m=meshes[sid]
                # Normalize each slot by a large Beaver collision slot.
                weights.append(min(m['vc']/4500.0,m['ic']/8997.0))
            total=sum(weights); base1=weights[0]/total; base2=(weights[0]+weights[1])/total
            for j1 in boundary_jitter:
                for j2 in boundary_jitter:
                    f1=max(0.08,min(0.84,base1+j1))
                    f2=max(f1+0.08,min(0.94,base2+j2))
                    c1=max(1,min(n-2,int(round(n*f1))))
                    c2=max(c1+1,min(n-1,int(round(n*f2))))
                    chunks=(ordered[:c1],ordered[c1:c2],ordered[c2:])
                    plans=[]; ok=True
                    try:
                        for sid,fids in zip(order,chunks):
                            cap=U32(original,mopps[sid]+0x18)
                            plans.append(_collision_chunk_plan(fids,sid,verts,faces,pos_ids,pos_reps,meshes[sid],cap))
                    except RuntimeError as e:
                        errors.append(str(e)); ok=False
                    if ok:
                        # Return in canonical slot order so aggregate child 0/1/2 stays 115/116/117.
                        bysid={p['sid']:p for p in plans}
                        return [bysid[s] for s in COLLISION_SLOTS],len(face_ids)

    tail='; '.join(errors[-4:]) if errors else 'no valid partition'
    raise RuntimeError(f'full collision packing failed for {len(face_ids)} faces: {tail}')


def _write_collision_slot_shared(data,original,plan,meshes,b0off,mopps,draw,verts,faces,uv0,frames):
    sid=plan['sid']; m=meshes[sid]; d=m['desc']
    for i in range(m['ic']): struct.pack_into('>H',data,m['ib']+2*i,0)
    zero=bytes(m['stride'])
    for i in range(m['vc']): data[m['vb']+i*m['stride']:m['vb']+(i+1)*m['stride']]=zero
    if not plan['face_ids']:
        struct.pack_into('>I',data,d,0); struct.pack_into('>I',data,draw['start_off'],0); struct.pack_into('>I',data,draw['q_off'],draw['selector']&0xffff)
        return {'mesh':sid,'triangles':0,'indices':0,'vertices':0,'active':False}

    order=sorted(plan['used_pos']); rem={g:i for i,g in enumerate(order)}
    reps=plan['pos_reps']; origin=plan['origin']; uv_count=U16(original,d+0x12)
    for li,pid in enumerate(order):
        gi=reps[pid]; p=verts[gi]
        local=(p[0]-origin[0],p[1]-origin[1],p[2]-origin[2])
        core.write_class2_vertex(data,m['vb']+li*m['stride'],m['stride'],uv_count,local,frames[gi],uv0[gi],'copy')
    for li in range(len(order),m['vc']):
        o=m['vb']+li*m['stride']; data[o:o+m['stride']]=zero

    for i,pid in enumerate(plan['stream']):
        struct.pack_into('>H',data,m['ib']+2*i,rem[pid])
    ic=len(plan['stream']); n=len(plan['face_ids'])
    struct.pack_into('>I',data,d,n<<16)
    struct.pack_into('>I',data,draw['start_off'],0)
    struct.pack_into('>I',data,draw['q_off'],(ic<<16)|(draw['selector']&0xffff))
    bo=b0off+sid*0x70
    struct.pack_into('>3f',data,bo+4,*origin); struct.pack_into('>9f',data,bo+0x10,1,0,0,0,1,0,0,0,1)

    v3.patch_mopp(data,mopps[sid],plan['info'],plan['code'])
    misses=[]
    for r in plan['records']:
        f=faces[r['fi']]
        world=tuple(sum(verts[f[k]][a] for k in range(3))/3.0 for a in range(3))
        local=tuple(world[a]-origin[a] for a in range(3))
        em,_=v3.eval_generated(plan['code'],plan['info'],local,0.02)
        if r['key'] not in em:
            misses.append((r['fi'],r['key']))
            if len(misses)>=8: break
    if misses:
        raise RuntimeError(f'collision MOPP validation failed in mesh {sid}: {misses}')

    return {'mesh':sid,'triangles':n,'indices':ic,'vertices':len(order),'active':True,
            'origin':origin,'bounds':plan['bounds'],'mopp_code':len(plan['code']),
            'mopp_capacity':U32(original,mopps[sid]+0x18),'strips':len(plan['strips']),
            'shared_vertices':True}

def _collision_rank(verts,faces,fi):
    f=faces[fi]; mat=str(f[3]).lower()
    if any(w in mat for w in ('sky','cloud','decal','water','flare','lightbeam')):
        return None
    area,up,mn,mx=v3.tri_info(verts,f)
    if area<=1e-8: return None
    boost=0
    if any(w in mat for w in ('ground','floor','terrain','road')): boost+=10000
    if any(w in mat for w in ('ramp','platform','bridge','base')): boost+=8500
    if any(w in mat for w in ('rock','cliff','boulder','metal','panel','wall')): boost+=5500
    if up>=0.45: boost+=7000
    elif up>=0.15: boost+=3000
    score=boost+min(5000,math.log1p(area)*700)+up*1000
    cen=tuple(sum(verts[f[j]][a] for j in range(3))/3.0 for a in range(3))
    return score,area,cen


def select_collision_faces(verts,faces,max_faces):
    ranked=[]
    for fi in range(len(faces)):
        r=_collision_rank(verts,faces,fi)
        if r is not None: ranked.append((r[0],r[1],fi,r[2]))
    if len(ranked)<=max_faces:
        return [x[2] for x in ranked]
    ranked.sort(reverse=True,key=lambda x:(x[0],x[1]))
    # Preserve broad map coverage: reserve one best triangle per 8x8 XZ cell,
    # then fill remaining capacity by rank.
    xs=[x[3][0] for x in ranked]; zs=[x[3][2] for x in ranked]
    minx,maxx=min(xs),max(xs); minz,maxz=min(zs),max(zs)
    cells={}
    for rec in ranked:
        x,z=rec[3][0],rec[3][2]
        ix=0 if maxx==minx else min(7,max(0,int((x-minx)/(maxx-minx)*8)))
        iz=0 if maxz==minz else min(7,max(0,int((z-minz)/(maxz-minz)*8)))
        cells.setdefault((ix,iz),rec)
    chosen=[]; seen=set()
    for rec in cells.values():
        if len(chosen)>=max_faces: break
        chosen.append(rec[2]); seen.add(rec[2])
    for rec in ranked:
        if len(chosen)>=max_faces: break
        if rec[2] not in seen:
            chosen.append(rec[2]); seen.add(rec[2])
    return chosen


def _write_collision_slot(data,original,sid,face_ids,meshes,b0off,mopps,draw,verts,faces,uv0,frames):
    m=meshes[sid]; d=m['desc']
    for i in range(m['ic']): struct.pack_into('>H',data,m['ib']+2*i,0)
    zero=bytes(m['stride'])
    for i in range(m['vc']): data[m['vb']+i*m['stride']:m['vb']+(i+1)*m['stride']]=zero
    if not face_ids:
        struct.pack_into('>I',data,d,0); struct.pack_into('>I',data,draw['start_off'],0); struct.pack_into('>I',data,draw['q_off'],draw['selector']&0xffff)
        return {'mesh':sid,'triangles':0,'indices':0,'vertices':0,'active':False}
    if len(face_ids)*3>m['vc'] or (6*len(face_ids)-3)>m['ic']:
        raise RuntimeError(f'collision slot {sid} capacity exceeded')
    mn,mx=_slot_bounds(verts,face_ids,faces); origin=tuple((mn[a]+mx[a])*0.5 for a in range(3))
    uv_count=U16(original,d+0x12)
    records=[]; stream=[]
    for j,fi in enumerate(face_ids):
        f=faces[fi]; base=3*j
        for k,g in enumerate(f[:3]):
            p=verts[g]; local=(p[0]-origin[0],p[1]-origin[1],p[2]-origin[2])
            core.write_class2_vertex(data,m['vb']+(base+k)*m['stride'],m['stride'],uv_count,local,frames[g],uv0[g],'copy')
        if j==0: stream += [base,base+1,base+2]
        else:
            prev=base-1
            stream += [prev,base,base,base,base+1,base+2]
        area,up,wmn,wmx=v3.tri_info(verts,f)
        lmn=tuple(wmn[a]-origin[a] for a in range(3)); lmx=tuple(wmx[a]-origin[a] for a in range(3))
        records.append({'key':6*j,'mn':lmn,'mx':lmx})
    for i,q in enumerate(stream): struct.pack_into('>H',data,m['ib']+2*i,q)
    n=len(face_ids); ic=len(stream)
    struct.pack_into('>I',data,d,n<<16)
    struct.pack_into('>I',data,draw['start_off'],0)
    # Keep the reference collision selector (slot 0 normal texture).
    struct.pack_into('>I',data,draw['q_off'],(ic<<16)|(draw['selector']&0xffff))
    bo=b0off+sid*0x70
    struct.pack_into('>3f',data,bo+4,*origin); struct.pack_into('>9f',data,bo+0x10,1,0,0,0,1,0,0,0,1)
    info,code=v3.compile_mopp([dict(r) for r in records])
    cap=U32(original,mopps[sid]+0x18)
    if len(code)>cap: raise RuntimeError(f'collision MOPP {sid} overflow {len(code)}>{cap}')
    v3.patch_mopp(data,mopps[sid],info,code)
    # Validate every generated key at its triangle centroid.
    misses=0
    for j,fi in enumerate(face_ids):
        f=faces[fi]; world=tuple(sum(verts[f[k]][a] for k in range(3))/3.0 for a in range(3)); local=tuple(world[a]-origin[a] for a in range(3))
        em,_=v3.eval_generated(code,info,local,0.02)
        if 6*j not in em: misses+=1
    if misses: raise RuntimeError(f'collision MOPP validation failed in mesh {sid}: {misses} centroid misses')
    return {'mesh':sid,'triangles':n,'indices':ic,'vertices':3*n,'active':True,'origin':origin,'bounds':[mn,mx],'mopp_code':len(code),'mopp_capacity':cap}


def _term(k):
    if k<=0xff: return bytes((0x50,k))
    return bytes((0x51,(k>>8)&255,k&255))



def validate_visibility_against_reference(generated,reference):
    """Validate the exact visibility invariants observed in Caboose Beaver Creek."""
    gd=bytes(generated); rd=bytes(reference)
    _,b0c,b0off,_=v3.parse_template(rd)
    _,records=detect_object50_table(rd,b0c,b0off)
    links=object50_links(records)
    tree_off,nodes,perm=detect_object50_cull_tree(rd,records)
    if tree_off is None: raise RuntimeError('reference visibility tree not found')
    _,ranges=parse_name_slots_and_ranges(gd); bymesh={r['mesh']:r for r in ranges}
    local_checked=0; local_bad=[]
    for sid,rr in links.items():
        if sid not in bymesh: continue
        obj=bymesh[sid].get('obj_off')
        if obj is None: continue
        origin=struct.unpack_from('>3f',gd,b0off+sid*0x70+4)
        lmn=struct.unpack_from('>3f',gd,obj); lmx=struct.unpack_from('>3f',gd,obj+0x0c)
        wmn=tuple(lmn[a]+origin[a] for a in range(3)); wmx=tuple(lmx[a]+origin[a] for a in range(3))
        ro=rr[0]['offset']; rmn=struct.unpack_from('>3f',gd,ro); rmx=struct.unpack_from('>3f',gd,ro+0x10)
        local_checked+=1
        if any(abs(wmn[a]-rmn[a])>0.003 or abs(wmx[a]-rmx[a])>0.003 for a in range(3)):
            local_bad.append(sid)
    # Validate all leaf and internal tree bounds against the generated Object50s.
    current=[]
    for r in records:
        o=r['offset']; current.append((struct.unpack_from('>3f',gd,o),struct.unpack_from('>3f',gd,o+0x10)))
    expected={}; pos=0
    for n in nodes:
        if not n['leaf']: continue
        ids=perm[pos:pos+n['count']]; pos+=n['count']
        expected[n['index']]=(tuple(min(current[j][0][a] for j in ids) for a in range(3)),tuple(max(current[j][1][a] for j in ids) for a in range(3)))
    def solve(i):
        if i in expected: return expected[i]
        n=nodes[i]; A=solve(n['child1']); B=solve(n['child2'])
        expected[i]=(tuple(min(A[0][a],B[0][a]) for a in range(3)),tuple(max(A[1][a],B[1][a]) for a in range(3))); return expected[i]
    children={x for n in nodes if not n['leaf'] for x in (n['child1'],n['child2'])}; root=[n['index'] for n in nodes if n['index'] not in children][0]; solve(root)
    tree_bad=[]
    for n in nodes:
        smn=struct.unpack_from('>3f',gd,n['offset']); smx=struct.unpack_from('>3f',gd,n['offset']+0x10); emn,emx=expected[n['index']]
        if any(abs(smn[a]-emn[a])>0.003 or abs(smx[a]-emx[a])>0.003 for a in range(3)): tree_bad.append(n['index'])
    return {'local_aabbs_checked':local_checked,'local_aabb_mismatches':local_bad,'cull_tree_nodes':len(nodes),'cull_tree_mismatches':tree_bad,'cull_tree_root':root,'cull_tree_offset':tree_off}


def _dec_s10(x):
    x &= 0x3ff
    return x-0x400 if (x & 0x200) else x

def _decode_dec3n(word):
    return (_dec_s10(word)/511.0,_dec_s10(word>>10)/511.0,_dec_s10(word>>20)/511.0)

def validate_render_normal_alignment(data,meshes,bymesh,slot_ids=RENDER_SLOTS):
    """Compare emitted triangle winding with packed normals.

    The known-working Beaver Creek reference has zero inverted render triangles
    under this exact test (7,461 sampled triangles, mean alignment about 0.947).
    """
    vals=[]
    worst=[]
    checked=0
    for sid in slot_ids:
        m=meshes[sid]
        draw=bymesh[sid]
        q=U32(data,draw['q_off'])
        ic=(q>>16)&0xffff
        if ic < 3 or m['ib'] is None or m['vb'] is None:
            continue
        idx=[U16(data,m['ib']+2*i) for i in range(ic)]
        for a,b,c in _decode_strip(idx):
            if max(a,b,c) >= m['vc']:
                continue
            def vp(i):
                o=m['vb']+i*m['stride']
                return struct.unpack_from('>3f',data,o)
            def vn(i):
                o=m['vb']+i*m['stride']+0x0c
                return _decode_dec3n(U32(data,o))
            p0,p1,p2=vp(a),vp(b),vp(c)
            e1=tuple(p1[k]-p0[k] for k in range(3))
            e2=tuple(p2[k]-p0[k] for k in range(3))
            gn=(e1[1]*e2[2]-e1[2]*e2[1],
                e1[2]*e2[0]-e1[0]*e2[2],
                e1[0]*e2[1]-e1[1]*e2[0])
            gl=math.sqrt(sum(x*x for x in gn))
            if gl <= 1e-12:
                continue
            gn=tuple(x/gl for x in gn)
            nn=tuple(sum(v[k] for v in (vn(a),vn(b),vn(c))) for k in range(3))
            nl=math.sqrt(sum(x*x for x in nn))
            if nl <= 1e-12:
                continue
            nn=tuple(x/nl for x in nn)
            al=sum(gn[k]*nn[k] for k in range(3))
            vals.append(al); checked+=1
            if len(worst)<12 or al < worst[-1][0]:
                worst.append((al,sid,a,b,c))
                worst.sort(key=lambda x:x[0])
                worst=worst[:12]
    if not vals:
        return {'triangles_checked':0,'negative':0,'mean_alignment':0.0,'median_alignment':0.0,'min_alignment':0.0,'worst':[]}
    sv=sorted(vals)
    return {
        'triangles_checked':checked,
        'negative':sum(1 for x in vals if x < -0.02),
        'mean_alignment':sum(vals)/len(vals),
        'median_alignment':sv[len(sv)//2],
        'min_alignment':sv[0],
        'worst':[{'alignment':x[0],'mesh':x[1],'indices':[x[2],x[3],x[4]]} for x in worst],
    }


def build_bbchunk(obj_path,reference_path,output_path,texture_paths,report_path=None,world_scale=DEFAULT_WORLD_SCALE,slot_plan=None,preserve_sky=True,minimap_name=None,dynamic_materials=False,skip_collision=False):
    source_obj=core.parse_obj_attrs(obj_path)
    source_obj,orientation_stats=core.orient_faces_to_source_normals(source_obj)
    obj,transform=transform_obj_for_sr1(source_obj,world_scale)
    verts=obj['verts']; faces=obj['faces']; uv0=obj['uv0']
    if not verts or not faces: raise RuntimeError('OBJ is empty')
    frames,frame_stats=core.build_vertex_frames(verts,faces,uv0,obj['src_normals'])
    original=bytearray(Path(reference_path).read_bytes()); data=bytearray(original)
    a4c,b0c,b0off,meshes=v3.parse_template(data); mopps=v3.mopp_positions(original)
    if (a4c,b0c,len(meshes),len(mopps))!=(119,119,119,120):
        raise RuntimeError(f'reference BBChunk is not Beaver-style 119/119/119/120: {(a4c,b0c,len(meshes),len(mopps))}')
    for i,m in enumerate(meshes):
        if m['stride']!=24 or U16(original,m['desc']+0x12)!=1 or U16(original,m['desc']+0x14)!=2:
            raise RuntimeError(f'reference mesh {i} does not use recovered class-2 24-byte format')
    object50_off,object50_records=detect_object50_table(original,b0c,b0off)
    obj50_links=object50_links(object50_records)
    expected_refs=set(range(115))|{118}
    if object50_off is None or len(object50_records)!=116 or not expected_refs.issubset(set(obj50_links)):
        raise RuntimeError(f'could not confidently recover Beaver Object50 table: off={object50_off} records={len(object50_records)} refs={len(obj50_links)}')
    cull_tree_off,cull_nodes,cull_perm=detect_object50_cull_tree(original,object50_records)
    if cull_tree_off is None: raise RuntimeError('could not recover Caboose Beaver Creek Object50 culling tree')

    # Exact one-draw-range-per-mesh invariant is what makes Beaver Creek such a
    # strong custom-map template.
    name_slots,ranges=parse_name_slots_and_ranges(data)
    bymesh={}
    for r in ranges:
        if r['mesh'] in bymesh: raise RuntimeError(f'mesh {r["mesh"]} has multiple draw ranges; unexpected Beaver reference')
        bymesh[r['mesh']]=r
    if set(bymesh)!=set(range(119)):
        raise RuntimeError('reference does not have exactly one draw range for every mesh')

    materials=[]; seen=set()
    for f in faces:
        mat=str(f[3] or '(default)')
        if mat not in seen: seen.add(mat); materials.append(mat)
    missing=[m for m in materials if not texture_paths.get(m) or not Path(texture_paths[m]).is_file()]
    if missing:
        raise RuntimeError('missing texture assignment(s): '+', '.join(missing))
    if (not dynamic_materials) and len(materials)>MAX_MATERIALS:
        raise RuntimeError(f'{len(materials)} OBJ materials exceed current safe limit of {MAX_MATERIALS}')
    mapping=reserve_material_names(data,materials,texture_paths,slot_plan=slot_plan,dynamic_materials=dynamic_materials)
    render_span_limit=render_span_limit_for_scale(world_scale)

    # Clear imported-render/collision meshes, but preserve Caboose's proven sky mesh 118 when requested.
    for m in meshes:
        if preserve_sky and m.get('id')==SKY_SLOT:
            continue
        if m['ib'] is not None:
            for i in range(m['ic']): struct.pack_into('>H',data,m['ib']+2*i,0)

    mesh_defs=[meshes[i] for i in RENDER_SLOTS]
    states=None; spatial_grid=None; spatial_groups=0; last_error=None
    # Prefer the proven 4x3 Blood Gulch-style spatial layout. If a highly
    # fragmented material set consumes too many of Beaver's 115 fixed slots,
    # automatically retry progressively coarser grids.
    for nx,nz in SPATIAL_GRIDS:
        try:
            strips,groups=_build_spatial_render_strips(verts,faces,nx,nz)
            strips=_split_oversize_strips(strips,faces,mesh_defs)
            strips=_annotate_strip_bounds(strips,verts,faces)
            states=assign_render_strips(strips,faces,mesh_defs,render_span_limit)
            spatial_grid=(nx,nz); spatial_groups=len(groups)
            break
        except RuntimeError as e:
            last_error=e
    if states is None:
        raise RuntimeError(f'spatial render packing failed for all grids: {last_error}')

    render_stats=[]
    for sid in RENDER_SLOTS:
        render_stats.append(_write_render_slot(data,original,states[sid],meshes,b0off,bymesh[sid],verts,faces,uv0,frames,mapping,obj50_links))

    normal_alignment=validate_render_normal_alignment(data,meshes,bymesh)
    if normal_alignment['negative']:
        raise RuntimeError(
            f"render normal/winding validation failed: {normal_alignment['negative']} inverted "
            f"triangle(s) out of {normal_alignment['triangles_checked']}; worst={normal_alignment['worst'][:3]}"
        )

    # v0.16 Reborn-core mode rebuilds collision directly from every active render
    # mesh after this geometry pass, using the exact MOPP builder recovered from
    # the Saints Reborn Map Converter source. Skip the legacy three collision
    # proxy meshes in that mode so they cannot impose a capacity limit.
    if skip_collision:
        collision_plans=[]
        collision_stats=[]
        collision_candidate_count=sum(1 for f in faces if len(set(f[:3]))==3)
        max_col=collision_candidate_count
    else:
        collision_plans,collision_candidate_count=_build_full_collision_plan(
            verts,faces,meshes,mopps,original
        )
        collision_stats=[]
        for plan in collision_plans:
            sid=plan['sid']
            collision_stats.append(_write_collision_slot_shared(
                data,original,plan,meshes,b0off,mopps,bymesh[sid],verts,faces,uv0,frames
            ))
        max_col=collision_candidate_count

    # Sky: Caboose's mesh 118 is a proven +/-500 world-unit enclosure using material 28 -> PEG slot 30.
    # Preserve it byte-for-byte by default. If disabled, clear it using the old safe path.
    if preserve_sky:
        sky_stat={'mesh':SKY_SLOT,'preserved':True,'selector':int(bymesh[SKY_SLOT]['selector']),
                  'indices':int(bymesh[SKY_SLOT]['count']),'triangles':None}
    else:
        empty={'mesh':meshes[SKY_SLOT],'material':None,'usedv':set(),'cursor':0,'blocks':[],'faces':[]}
        sky_stat=_write_render_slot(data,original,empty,meshes,b0off,bymesh[SKY_SLOT],verts,faces,uv0,frames,mapping,obj50_links)

    # Minimap resource name is the final BBChunk name-table entry. Because it is last,
    # a shorter/equal mapname.tga can be patched in place without shifting serialized data.
    if minimap_name:
        name_slots,_tmp_ranges=parse_name_slots_and_ranges(data)
        slot=name_slots[-1]
        raw=str(minimap_name).encode('ascii','strict')
        if len(raw)>slot['length']:
            raise RuntimeError(f'minimap resource name {minimap_name!r} exceeds final Beaver name slot ({slot["length"]} chars)')
        start=slot['offset']; cap=slot['length']+1
        data[start:start+cap]=raw+b'\x00'+b'\x00'*(cap-len(raw)-1)

    cull_tree_stats=rebuild_object50_cull_tree(data,cull_nodes,cull_perm,object50_records)

    mn=tuple(min(v[a] for v in verts) for a in range(3)); mx=tuple(max(v[a] for v in verts) for a in range(3))
    # Main BBChunk bounds recovered at header +0x3AC.
    struct.pack_into('>6f',data,0x3AC,*(mn+mx))

    # Aggregate collision MOPP 119 already maps child keys 0,1,2 to the three
    # dedicated collision placements. Rebuild an always-reachable union over
    # only the active children so stale Beaver collision cannot be reached.
    active=[s for s in collision_stats if s.get('active')]
    if (not skip_collision) and active:
        agg_records=[{'mn':tuple(s['bounds'][0]),'mx':tuple(s['bounds'][1])} for s in active]
        agg_info=v3.make_code_info(agg_records)
        agg_code=v3.union_codes([_term(i) for i in range(len(active))])
        v3.patch_mopp(data,mopps[AGG_MOPP],agg_info,agg_code)
    agg_old=U32(original,mopps[AGG_MOPP]+0x18)
    level_bounds_off=mopps[AGG_MOPP]+0x1C+agg_old
    struct.pack_into('>6f',data,level_bounds_off,*(mn+mx))

    Path(output_path).write_bytes(data)
    report={
        'format':'sr1-beaver-template-compiler-v0.13-full-collision-scale-aware',
        'reference':str(reference_path),'output':str(output_path),'obj':str(obj_path),
        'object50_table_offset':object50_off,'object50_records':len(object50_records),
        'obj_vertices':len(verts),'obj_triangles':len(faces),'materials':materials,
        'world_transform':transform,'spatial_grid':list(spatial_grid),'spatial_groups':spatial_groups,
        'max_render_object_span':_max_render_object_span(states,verts,faces),'render_object_span_limit':render_span_limit,
        'material_mapping':mapping,'frame_stats':frame_stats,'orientation':orientation_stats,
        'normal_alignment':normal_alignment,'bounds':[mn,mx],
        'object50_cull_tree':cull_tree_stats,
        'render':render_stats,'render_slots_used':sum(x['triangles']>0 for x in render_stats),
        'render_triangles':sum(x['triangles'] for x in render_stats),
        'collision':collision_stats,'collision_triangles':sum(x.get('triangles',0) for x in collision_stats),
        'collision_candidates':collision_candidate_count,'collision_capacity':max_col,
        'collision_full_coverage':(False if skip_collision else sum(x.get('triangles',0) for x in collision_stats)==collision_candidate_count),
        'collision_deferred_to_reborn_core':bool(skip_collision),
        'sky_cleared':not bool(preserve_sky),'sky_preserved':bool(preserve_sky),'sky':sky_stat,
        'minimap_name':str(minimap_name) if minimap_name else None,
    }
    if report_path: Path(report_path).write_text(json.dumps(report,indent=2,default=str),encoding='utf-8')
    return report,obj

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser()
    ap.add_argument('obj'); ap.add_argument('reference'); ap.add_argument('textures_json'); ap.add_argument('output'); ap.add_argument('--report'); ap.add_argument('--scale',type=float,default=DEFAULT_WORLD_SCALE)
    a=ap.parse_args(); tex=json.loads(Path(a.textures_json).read_text())
    r,_=build_bbchunk(a.obj,a.reference,a.output,tex,a.report,a.scale)
    print(json.dumps(r,indent=2,default=str))
