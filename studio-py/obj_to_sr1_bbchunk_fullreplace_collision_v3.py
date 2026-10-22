#!/usr/bin/env python3
from pathlib import Path
from collections import defaultdict, deque
import struct, math, re, sys, importlib.util

SOURCES = {
    68: {"b0":137,"obj50":129},
    75: {"b0":144,"obj50":136},
}
OBJECT50_BASE=0x2181F0
OBJECT50_STRIDE=0x50


def align(x,a): return (x+a-1)&~(a-1)
def u16(b,o): return struct.unpack_from('>H',b,o)[0]
def u32(b,o): return struct.unpack_from('>I',b,o)[0]
def f32(b,o): return struct.unpack_from('>f',b,o)[0]

def parse_obj(path):
    verts=[]; faces=[]; mat=''
    for line in Path(path).open('r',encoding='utf-8',errors='ignore'):
        if line.startswith('v '):
            p=line.split(); verts.append((float(p[1]),float(p[2]),float(p[3])))
        elif line.startswith('usemtl '):
            mat=line.strip().split(None,1)[1]
        elif line.startswith('f '):
            ids=[]
            for tok in line.split()[1:]:
                n=int(tok.split('/')[0]); ids.append(n-1 if n>0 else len(verts)+n)
            for i in range(1,len(ids)-1): faces.append((ids[0],ids[i],ids[i+1],mat))
    return verts,faces

def tri_info(verts, face):
    ia,ib,ic,mat=face; a,b,c=verts[ia],verts[ib],verts[ic]
    ux,uy,uz=b[0]-a[0],b[1]-a[1],b[2]-a[2]
    vx,vy,vz=c[0]-a[0],c[1]-a[1],c[2]-a[2]
    nx=uy*vz-uz*vy; ny=uz*vx-ux*vz; nz=ux*vy-uy*vx
    L=math.sqrt(nx*nx+ny*ny+nz*nz)
    area=0.5*L
    any_=abs(ny/L) if L>1e-20 else 0.0
    mn=(min(a[0],b[0],c[0]),min(a[1],b[1],c[1]),min(a[2],b[2],c[2]))
    mx=(max(a[0],b[0],c[0]),max(a[1],b[1],c[1]),max(a[2],b[2],c[2]))
    return area,any_,mn,mx

def stripify(faces):
    # Only geometry connectivity matters; keep face ids so collision priorities survive reordering.
    edge=defaultdict(list)
    for i,(a,b,c,_) in enumerate(faces):
        edge[(a,b)].append((i,c)); edge[(b,c)].append((i,a)); edge[(c,a)].append((i,b))
    def grow(seed,orient,used):
        seq=list(orient); fs=[seed]; loc={seed}; parity=1
        while True:
            p,q=seq[-2],seq[-1]
            req=(q,p) if parity&1 else (p,q)
            cands=[(ti,x) for ti,x in edge.get(req,()) if ti not in used and ti not in loc]
            if not cands: break
            # favor continuation
            best=None
            for ti,x in cands:
                np=parity+1; nreq=(x,q) if np&1 else (q,x)
                score=sum(1 for tj,_ in edge.get(nreq,()) if tj not in used and tj not in loc and tj!=ti)
                cand=(score,ti,x)
                if best is None or cand>best: best=cand
            _,ti,x=best
            seq.append(x); fs.append(ti); loc.add(ti); parity+=1
        return seq,fs
    used=set(); strips=[]
    while len(used)<len(faces):
        rem=[i for i in range(len(faces)) if i not in used]
        seed=rem[0]
        a,b,c,_=faces[seed]
        seq,fs=max((grow(seed,o,used) for o in ((a,b,c),(b,c,a),(c,a,b))),key=lambda z:len(z[1]))
        strips.append({"seq":seq,"faces":fs})
        used.update(fs)
    return strips

def parse_template(data):
    cur=align(968,64); nc=u32(data,cur); cur+=4+nc*4
    for _ in range(nc): cur=data.index(0,cur)+1
    cur=align(cur,64)
    a4c=u32(data,cur); b0c=u32(data,cur+4); mc=u32(data,cur+8); b8c=u32(data,cur+12); cur+=16
    cur=align(cur,64)+a4c*0x10
    b0off=align(cur,64); cur=b0off+b0c*0x70
    cur=align(cur,64)+b8c*0x64
    cur=align(cur,64); c=u32(data,cur); cur+=4+c
    cur=align(cur,64); c=u32(data,cur); cur+=4+c+0x18
    cur=align(cur,4); cur+=mc*4; ptr=[u32(data,cur+i*4) for i in range(mc)]; cur+=mc*4; cur=align(cur,64)
    desc=[]
    for i in range(mc):
        cur=align(cur,16); d=cur; desc.append(d); cur+=0x58
        if ptr[i]:
            cur=align(cur,16); comp=cur; cur+=0x10
            h0=u32(data,comp)!=0; h1=u32(data,comp+4)!=0; c0=u16(data,comp+8); c1=u16(data,comp+10)
            if h0: cur=align(cur,32)+c0*2
            if h1: cur=align(cur,32)+c1*2
    cur=align(cur,0x1000); meshes=[]
    for i,d in enumerate(desc):
        hv=u32(data,d+4)!=0; hi=u32(data,d+8)!=0; vc=u16(data,d+0xc); ic=u16(data,d+0xe); stride=u16(data,d+0x10)
        ib=vb=None
        if hi: cur=align(cur,0x20); ib=cur; cur+=ic*2
        if hv: cur=align(cur,0x20); vb=cur; cur+=vc*stride
        meshes.append({"id":i,"desc":d,"vc":vc,"ic":ic,"stride":stride,"ib":ib,"vb":vb})
    return a4c,b0c,b0off,meshes

def mopp_positions(data):
    out=[]; i=0
    while True:
        j=data.find(b'PPOM',i)
        if j<0: break
        if j+0x1c<=len(data) and u32(data,j+4)==300:
            sz=u32(data,j+0x18)
            if j+0x1c+sz<=len(data): out.append(j)
        i=j+1
    return out

def walk_keys(code):
    # Minimal all-path disassembler, enough to recover emitted old shape keys.
    def be16(o): return (code[o]<<8)|code[o+1]
    def be24(o): return (code[o]<<16)|(code[o+1]<<8)|code[o+2]
    def be32(o): return (code[o]<<24)|(code[o+1]<<16)|(code[o+2]<<8)|code[o+3]
    todo=deque([(0,0)]); seen=set(); keys=[]
    while todo:
        pc,base=todo.popleft()
        if (pc,base) in seen or not (0<=pc<len(code)): continue
        seen.add((pc,base)); op=code[pc]
        if op==0: continue
        if 1<=op<=4: todo.append((pc+4,base))
        elif op==5: todo.append((pc+2+code[pc+1],base))
        elif op==6: todo.append((pc+3+be16(pc+1),base))
        elif op==7: todo.append((pc+4+be24(pc+1),base))
        elif op==9: todo.append((pc+2,base+code[pc+1]))
        elif op==0x0a: todo.append((pc+3,base+be16(pc+1)))
        elif op==0x0b: todo.append((pc+5,be32(pc+1)))
        elif 0x10<=op<=0x1c:
            n=pc+4; todo.append((n,base)); todo.append((n+code[pc+3],base))
        elif 0x20<=op<=0x22:
            n=pc+3; todo.append((n,base)); todo.append((n+code[pc+2],base))
        elif 0x23<=op<=0x25:
            n=pc+7; todo.append((n+be16(pc+3),base)); todo.append((n+be16(pc+5),base))
        elif 0x26<=op<=0x28: todo.append((pc+3,base))
        elif 0x29<=op<=0x2b: todo.append((pc+7,base))
        elif 0x30<=op<=0x4f: keys.append(base+op-0x30)
        elif op==0x50: keys.append(base+code[pc+1])
        elif op==0x51: keys.append(base+be16(pc+1))
        elif op==0x52: keys.append(base+be24(pc+1))
        elif op==0x53: keys.append(base+be32(pc+1))
        elif 0x60<=op<=0x63: todo.append((pc+2,base))
        elif 0x64<=op<=0x67: todo.append((pc+3,base))
        elif 0x68<=op<=0x6b: todo.append((pc+5,base))
    return sorted(set(keys))

def derive_segments(data,mopps,src):
    off=mopps[src]; sz=u32(data,off+0x18); keys=walk_keys(data[off+0x1c:off+0x1c+sz])
    g=defaultdict(list)
    for k in keys: g[k>>16].append(k&0xffff)
    return [{"h":h,"start":min(v),"end":max(v),"cursor":min(v),"has":False} for h,v in sorted(g.items())], keys

def pack_strips(strips, faces, verts, slot_state):
    # Clear all candidate IBs before placement; caller already cleared every mesh globally.
    # Long strips first reduces fragmentation and distributes the source material order.
    work=sorted(strips,key=lambda s:len(s['seq']),reverse=True)
    assignments=[]
    for st in work:
        need0=len(st['seq'])
        candidates=[]
        stverts=set(st['seq'])
        for src,S in slot_state.items():
            addv=len(stverts-S['usedv'])
            if len(S['usedv'])+addv>S['mesh']['vc']: continue
            for si,seg in enumerate(S['segments']):
                need=need0+(1 if seg['has'] else 0)
                rem=seg['end']-seg['cursor']+1
                if need<=rem:
                    # best-fit segment, mild source utilization balance
                    waste=rem-need
                    util=sum(max(0,x['cursor']-x['start']) for x in S['segments'])/sum(x['end']-x['start']+1 for x in S['segments'])
                    candidates.append((waste+util*25,src,si,need,addv))
        if not candidates: raise RuntimeError('could not pack strip len=%d'%len(st['seq']))
        _,src,si,need,addv=min(candidates)
        S=slot_state[src]; seg=S['segments'][si]; p=seg['cursor']
        if seg['has']:
            struct.pack_into('>H',S['data'],S['mesh']['ib']+2*p,0xffff); p+=1
        start=p
        # local vertex remap assigned later; for now save globals in virtual IB map
        for j,gidx in enumerate(st['seq']): S['ib_global'][start+j]=gidx
        # Shape key for each triangle = proven subpart high16 + triangle-window start low16.
        for j,fi in enumerate(st['faces']):
            key=(seg['h']<<16)|(start+j)
            assignments.append((fi,src,key,start+j,seg['h']))
        seg['cursor']=start+len(st['seq']); seg['has']=True
        S['usedv'].update(stverts)
    return assignments

def finalize_slot(data,S,verts):
    m=S['mesh']; order=sorted(S['usedv']); rem={g:i for i,g in enumerate(order)}
    # fill only supported positions; unsupported and unused remain FFFF
    for pos,g in S['ib_global'].items(): struct.pack_into('>H',data,m['ib']+2*pos,rem[g])
    attr=bytes(data[m['vb']+12:m['vb']+m['stride']])
    for li,g in enumerate(order):
        o=m['vb']+li*m['stride']; struct.pack_into('>3f',data,o,*verts[g]); data[o+12:o+m['stride']]=attr
    for li in range(len(order),m['vc']):
        o=m['vb']+li*m['stride']; struct.pack_into('>3f',data,o,0.0,0.0,0.0); data[o+12:o+m['stride']]=attr
    return order

def make_code_info(records):
    mn=[min(r['mn'][a] for r in records) for a in range(3)]; mx=[max(r['mx'][a] for r in records) for a in range(3)]
    span=max(mx[a]-mn[a] for a in range(3)); margin=max(0.5,span*0.01)
    off=[mn[a]-margin for a in range(3)]
    span2=max((mx[a]+margin)-off[a] for a in range(3))
    scale=(240.0*65536.0)/span2
    return off+[scale]

def rootq(info,x,a):
    q=int(math.floor((x-info[a])*info[3]+0.5))-1
    h=(q>>16)&0xffff
    return h-0x10000 if h&0x8000 else h

def quantize_records(records,info,pad=1):
    for r in records:
        lo=[];hi=[]
        for a in range(3):
            q0=min(rootq(info,r['mn'][a],a),rootq(info,r['mx'][a],a)); q1=max(rootq(info,r['mn'][a],a),rootq(info,r['mx'][a],a))
            lo.append(max(0,q0-pad)); hi.append(min(255,q1+pad))
        r['lo']=lo;r['hi']=hi;r['center']=[(lo[a]+hi[a])//2 for a in range(3)]

def emit_low(low):
    if low<=31:return bytes((0x30+low,))
    if low<=255:return bytes((0x50,low))
    return bytes((0x51,(low>>8)&255,low&255))

def compile_spatial(records):
    if len(records)==1:return emit_low(records[0]['key']&0xffff)
    # Peel a small spatially-low cluster so the short-branch skip always fits U8.
    spreads=[]
    for a in range(3): spreads.append(max(r['center'][a] for r in records)-min(r['center'][a] for r in records))
    axis=max(range(3),key=lambda a:spreads[a])
    s=sorted(records,key=lambda r:(r['center'][axis],r['key']))
    k=min(24,max(1,len(s)//2))
    while True:
        A=s[:k]; B=s[k:]
        ca=compile_spatial(A)
        if len(ca)<=255 or k==1: break
        k=max(1,k//2)
    cb=compile_spatial(B)
    hi=max(r['hi'][axis] for r in A); lo=min(r['lo'][axis] for r in B)
    return bytes((0x10+axis, max(0,min(255,hi)), max(0,min(255,lo)), len(ca)))+ca+cb

def compile_group(records,h):
    # Set primitive base to subpart high16; low16 leaf encodings then cost 1-3 bytes.
    base=h<<16
    return bytes((0x0b,(base>>24)&255,(base>>16)&255,(base>>8)&255,base&255))+compile_spatial(records)

def union_codes(codes):
    if len(codes)==1:return codes[0]
    # Balanced union; wide X split configured so in-range queries traverse both branches.
    mid=len(codes)//2; A=union_codes(codes[:mid]); B=union_codes(codes[mid:])
    if len(A)>0xffff: raise RuntimeError('union branch too large')
    return bytes((0x23,0xff,0x00,0,0,(len(A)>>8)&255,len(A)&255))+A+B

def compile_mopp(records):
    info=make_code_info(records); quantize_records(records,info)
    groups=defaultdict(list)
    for r in records:groups[r['key']>>16].append(r)
    codes=[compile_group(groups[h],h) for h in sorted(groups)]
    return info,union_codes(codes)

def priority(face,ti):
    area,any_,mn,mx=ti; mat=face[3]
    # Major walkable surfaces first, then structural collision.
    if mat=='blood_ground': p=10000
    elif mat in ('cap_ramp','cap_ramp_blue'): p=9500
    elif mat=='metal_flat_generic': p=9000 if any_>=0.45 else 6500
    elif mat in ('metal_panels_generic_ext_clean','metal_panels_generic_ext'): p=8500 if any_>=0.45 else 6000
    elif mat=='cap_cliff01b': p=7000
    elif mat in ('cap_metal','metal_panels_ext_unearthed'): p=6500
    elif mat in ('beavercreek_boulder','cap_moss01b'): p=5000
    else: p=1000
    return (p, any_*100, math.log1p(area))

def choose_fit(records,slot_size):
    # Always compile highest-priority records; binary search largest prefix that fits.
    ranked=sorted(records,key=lambda r:r['prio'],reverse=True)
    lo,hi=1,len(ranked); best=None
    while lo<=hi:
        mid=(lo+hi)//2
        subset=ranked[:mid]
        info,code=compile_mopp(subset)
        if len(code)<=slot_size:
            best=(subset,info,code); lo=mid+1
        else: hi=mid-1
    if best is None: raise RuntimeError('no collision records fit MOPP slot')
    return best

def patch_mopp(data,off,info,code):
    old=u32(data,off+0x18)
    if len(code)>old: raise RuntimeError('MOPP code overflow %d>%d'%(len(code),old))
    struct.pack_into('>4f',data,off+8,*info)
    data[off+0x1c:off+0x1c+old]=code+bytes(old-len(code))
    # keep old serialized codeSize to preserve every following offset
    return old

def eval_generated(code,info,p,rad=0.05):
    q=[rootq(info,p[a],a) for a in range(3)]
    # radius root units (roughly) +2 safety
    rr=max(1,int(math.ceil(rad*info[3]/65536.0))+1)
    todo=[(0,0)]; emits=[];steps=0
    while todo:
        pc,base=todo.pop()
        while 0<=pc<len(code):
            steps+=1; op=code[pc]
            if op==0:break
            if op==0x0b:
                base=(code[pc+1]<<24)|(code[pc+2]<<16)|(code[pc+3]<<8)|code[pc+4];pc+=5
            elif 0x10<=op<=0x12:
                a=op-0x10; hi=code[pc+1];lo=code[pc+2];sk=code[pc+3];n=pc+4
                if q[a]+rr<lo:pc=n
                elif q[a]>rr+hi:pc=n+sk
                else:todo.append((n+sk,base));pc=n
            elif 0x23<=op<=0x25:
                a=op-0x23;hi=code[pc+1];lo=code[pc+2];A=(code[pc+3]<<8)|code[pc+4];B=(code[pc+5]<<8)|code[pc+6];n=pc+7
                if q[a]+rr<lo:pc=n+A
                elif q[a]>rr+hi:pc=n+B
                else:todo.append((n+B,base));pc=n+A
            elif 0x30<=op<=0x4f:emits.append(base+op-0x30);break
            elif op==0x50:emits.append(base+code[pc+1]);break
            elif op==0x51:emits.append(base+((code[pc+1]<<8)|code[pc+2]));break
            else:raise RuntimeError('bad generated opcode %02X'%op)
    return emits,steps

def main(obj_path,template_path,out_path,report_path):
    verts,faces=parse_obj(obj_path); infos=[tri_info(verts,f) for f in faces]; strips=stripify(faces)
    original=bytearray(Path(template_path).read_bytes()); data=bytearray(original)
    a4c,b0c,b0off,meshes=parse_template(data); mopps=mopp_positions(original)
    if len(mopps)<317: raise RuntimeError('expected source+aggregate MOPPs')

    # Recover proven shape-key subpart/index ranges from original source MOPPs.
    slot={}
    for src,meta in SOURCES.items():
        segs,oldkeys=derive_segments(original,mopps,src)
        slot[src]={"mesh":meshes[src],"segments":segs,"usedv":set(),"ib_global":{},"data":data,"oldkeys":oldkeys,**meta}

    # Full visual replacement: strip-cut every original render mesh.
    for m in meshes:
        if m['ib'] is not None:
            for i in range(m['ic']): struct.pack_into('>H',data,m['ib']+2*i,0xffff)

    assignments=pack_strips(strips,faces,verts,slot)
    for src,S in slot.items(): finalize_slot(data,S,verts)

    # Build face -> (source,key), then collision records.
    face_map={fi:(src,key,lo,h) for fi,src,key,lo,h in assignments}
    bysrc=defaultdict(list)
    for fi,face in enumerate(faces):
        src,key,low,h=face_map[fi]; area,any_,mn,mx=infos[fi]
        bysrc[src].append({"fi":fi,"key":key,"mn":mn,"mx":mx,"prio":priority(face,infos[fi]),"mat":face[3],"area":area,"any":any_})

    chosen={}; src_stats={}
    for src,S in slot.items():
        off=mopps[src]; cap=u32(original,off+0x18)
        subset,ci,code=choose_fit(bysrc[src],cap)
        patch_mopp(data,off,ci,code)
        chosen[src]=subset
        src_stats[src]=(ci,code,cap)

    # Put two collision/render placements at exact OBJ coordinates and update Object50 AABBs.
    for src,S in slot.items():
        recs=bysrc[src]
        mn=[min(r['mn'][a] for r in recs) for a in range(3)]; mx=[max(r['mx'][a] for r in recs) for a in range(3)]
        bo=b0off+S['b0']*0x70
        struct.pack_into('>3f',data,bo+4,0.0,0.0,0.0)
        struct.pack_into('>9f',data,bo+0x10,1,0,0,0,1,0,0,0,1)
        oo=OBJECT50_BASE+S['obj50']*OBJECT50_STRIDE
        struct.pack_into('>3f',data,oo,*mn); struct.pack_into('>3f',data,oo+0x10,*mx)

    # Aggregate collision MOPP: ONLY the two Blood Gulch B0s. This intentionally removes old invisible mplobby collision.
    elig=[]
    for i in range(b0c):
        fl=u32(data,b0off+i*0x70+0x6c)
        if (fl&0x4c7)==0: elig.append(i)
    aggkeys=[elig.index(SOURCES[s]['b0']) for s in sorted(SOURCES)]
    allrecs=[r for s in chosen for r in chosen[s]]
    agginfo=make_code_info(allrecs)
    # always-both branch, each terminal is key8
    a,b=aggkeys
    la=bytes((0x50,a)) if a<=255 else bytes((0x51,a>>8,a&255))
    lb=bytes((0x50,b)) if b<=255 else bytes((0x51,b>>8,b&255))
    aggcode=bytes((0x23,0xff,0x00,0,0,0,len(la)))+la+lb
    patch_mopp(data,mopps[316],agginfo,aggcode)

    # Validation: each selected collision triangle centroid must emit its own shape key.
    misses=[]; cand=[]; steps=[]
    for src,recs in chosen.items():
        ci,code,cap=src_stats[src]
        for r in recs:
            f=faces[r['fi']]; p=tuple(sum(verts[f[j]][a] for j in range(3))/3 for a in range(3))
            em,st=eval_generated(code,ci,p,0.02);cand.append(len(em));steps.append(st)
            if r['key'] not in em:
                misses.append((src,r['fi'],r['key'],p,em[:20]))
                if len(misses)>20:break

    Path(out_path).write_bytes(data)
    mats=defaultdict(int)
    for s in chosen:
        for r in chosen[s]:mats[r['mat']]+=1
    lines=[
        'Blood Gulch SR1 full replacement + experimental custom collision v3',
        '==================================================================',
        f'OBJ vertices: {len(verts)}',f'OBJ triangles: {len(faces)}',f'visual strips: {len(strips)}',
        f'MOPPs found: {len(mopps)}',f'aggregate keys used: {aggkeys}',
        '', 'Visual packing:'
    ]
    for src,S in slot.items():
        assigned=len(bysrc[src]); ci,code,cap=src_stats[src]
        lines.append(f'  source {src} B0 {S["b0"]}: visual triangles={assigned}; collision triangles={len(chosen[src])}; MOPP generated={len(code)}/{cap} bytes')
        lines.append('    proven key segments: '+', '.join(f'{x["h"]}:{x["start"]}-{x["end"]}' for x in S['segments']))
    lines += ['',f'Total Blood Gulch collision triangles: {sum(len(v) for v in chosen.values())}/{len(faces)}',
              f'Centroid MOPP validation misses: {len(misses)}',
              f'Average/max source candidates: {(sum(cand)/len(cand) if cand else 0):.2f}/{(max(cand) if cand else 0)}',
              '', 'Collision triangles by OBJ material:']
    for mat,n in sorted(mats.items(),key=lambda x:-x[1]): lines.append(f'  {mat}: {n}')
    lines += ['', 'IMPORTANT:',
              '- Old mplobby render geometry is cleared.',
              '- Aggregate MOPP now routes ONLY to the two Blood Gulch placements, so old lobby aggregate collision is removed.',
              '- Per-source MOPPs for source 68 and 75 are rebuilt over selected Blood Gulch triangle shape keys.',
              '- Collision selection prioritizes blood_ground, ramps, and horizontal structural surfaces to fit the existing serialized MOPP code budgets.',
              '- This is the first custom-triangle collision experiment; if the game accepts the recovered shape-key mapping, Blood Gulch terrain should become solid.',
              '- Existing SR1 material/render metadata is still reused.']
    if misses:lines+=['','VALIDATION MISSES:']+[repr(x) for x in misses]
    Path(report_path).write_text('\n'.join(lines),encoding='utf-8')
    print('\n'.join(lines))

if __name__=='__main__':
    if len(sys.argv)!=5:
        print('usage: obj_to_sr1_bbchunk_fullreplace_collision_v3.py input.obj template.bbchunk_xbox2 output.bbchunk_xbox2 report.txt');sys.exit(2)
    main(*sys.argv[1:])
