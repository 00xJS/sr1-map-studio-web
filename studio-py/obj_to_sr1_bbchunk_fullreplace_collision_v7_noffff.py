#!/usr/bin/env python3
# Saints Row 1 Xbox 360 arbitrary OBJ importer - v7
#
# Fix for the "giant/fucked triangles" experiment:
#   * NEVER writes 0xFFFF to a render index buffer.
#   * Clears old mplobby render meshes with index 0 (all-degenerate triangles).
#   * Splits the OBJ into material-local triangle strips.
#   * Each strip is isolated with repeated-vertex degenerates:
#
#         A A B C ... L L
#
#     or A A A B C ... L L when one extra duplicate is needed to make the
#     first real strip triangle start on even parity.
#
#   * Every custom strip is packed wholly inside a recovered Havok source-key
#     segment, so its real triangle windows retain valid shape keys.
#
# Collision MOPPs are rebuilt exactly as in the working custom-collision test.

from pathlib import Path
from collections import defaultdict
import importlib.util, struct, math, sys

HERE = Path(__file__).resolve().parent
V3 = HERE / "obj_to_sr1_bbchunk_fullreplace_collision_v3.py"
spec = importlib.util.spec_from_file_location("sr1v3", V3)
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)

SOURCES = {
    68: {"b0":137, "obj50":129, "target_faces":1900, "target_ground":850},
    75: {"b0":144, "obj50":136, "target_faces":850,  "target_ground":400},
    74: {"b0":143, "obj50":135, "target_faces":1500, "target_ground":650},
    67: {"b0":136, "obj50":128, "target_faces":1205, "target_ground":533},
}
ORDER = [68,75,74,67]

def material_stripify(faces):
    # Same strip-growth idea as v3, but never cross a usemtl boundary.
    edge=defaultdict(list)
    for i,(a,b,c,mat) in enumerate(faces):
        edge[(a,b,mat)].append((i,c))
        edge[(b,c,mat)].append((i,a))
        edge[(c,a,mat)].append((i,b))

    def grow(seed, orient, used):
        mat=faces[seed][3]
        seq=list(orient)
        fs=[seed]
        local={seed}
        parity=1
        while True:
            p,q=seq[-2],seq[-1]
            req=(q,p,mat) if (parity&1) else (p,q,mat)
            cands=[(ti,x) for ti,x in edge.get(req,()) if ti not in used and ti not in local]
            if not cands:
                break
            best=None
            for ti,x in cands:
                np=parity+1
                nreq=(x,q,mat) if (np&1) else (q,x,mat)
                score=sum(1 for tj,_ in edge.get(nreq,()) if tj not in used and tj not in local and tj!=ti)
                cand=(score,ti,x)
                if best is None or cand>best:
                    best=cand
            _,ti,x=best
            seq.append(x)
            fs.append(ti)
            local.add(ti)
            parity+=1
        return seq,fs

    used=set()
    strips=[]
    for seed in range(len(faces)):
        if seed in used:
            continue
        a,b,c,mat=faces[seed]
        seq,fs=max(
            (grow(seed,o,used) for o in ((a,b,c),(b,c,a),(c,a,b))),
            key=lambda z:len(z[1])
        )
        strips.append({"seq":seq,"faces":fs,"mat":mat})
        used.update(fs)
    return strips

def block_layout(cursor, strip):
    # Prefix is repeated A vertices.  Choose 2 or 3 copies so the first real
    # triangle A,B,C has an EVEN global strip window-start parity.
    #
    # prefix A A [A], then seq[1:] = B C ..., suffix L L
    k = 2 if ((cursor + 1) & 1) == 0 else 3
    real_base = cursor + k - 1
    total_len = k + (len(strip["seq"]) - 1) + 2
    return k,total_len,real_base

def term(k):
    if k <= 0xFF:
        return bytes((0x50,k))
    return bytes((0x51,(k>>8)&255,k&255))

def standard_strip_faces(indices):
    # Real GPU-style geometry check: degenerate windows still advance parity,
    # but only non-degenerate triangles become visible.
    out=[]
    for end in range(2,len(indices)):
        a,b,c=indices[end-2],indices[end-1],indices[end]
        if a==b or b==c or a==c:
            continue
        if ((end-2)&1):
            a,b=b,a
        out.append((a,b,c))
    return out

def main(obj_path, template_path, out_path, report_path):
    verts,faces=v3.parse_obj(obj_path)
    infos=[v3.tri_info(verts,f) for f in faces]
    strips=material_stripify(faces)

    original=bytearray(Path(template_path).read_bytes())
    data=bytearray(original)
    a4c,b0c,b0off,meshes=v3.parse_template(data)
    mopps=v3.mopp_positions(original)

    # Critical v7 change: old lobby geometry is made harmless by index 0,
    # NOT 0xFFFF. Every resulting strip triangle is degenerate.
    cleared=0
    for m in meshes:
        if m["ib"] is not None:
            for i in range(m["ic"]):
                struct.pack_into(">H",data,m["ib"]+2*i,0)
            cleared+=1

    # Recovered old Havok shape-key spans become packing regions.
    state={}
    for src in ORDER:
        segs,_=v3.derive_segments(original,mopps,src)
        state[src]={
            "mesh":meshes[src],
            "segments":[dict(s,cursor=s["start"]) for s in segs],
            "usedv":set(),
            "face_count":0,
            "ground_count":0,
            "blocks":[],
            **SOURCES[src],
        }

    # Ground first, then longest strips.  Balance across MOPP budgets.
    work=sorted(
        strips,
        key=lambda s: ((s["mat"]=="blood_ground"), len(s["faces"])),
        reverse=True
    )

    face_map={}
    for st in work:
        stv=set(st["seq"])
        is_ground=(st["mat"]=="blood_ground")
        candidates=[]

        for src in ORDER:
            S=state[src]
            m=S["mesh"]
            if len(S["usedv"] | stv) > m["vc"]:
                continue

            for si,seg in enumerate(S["segments"]):
                k,L,base=block_layout(seg["cursor"],st)
                endpos=seg["cursor"]+L-1
                if endpos > seg["end"]:
                    continue
                if endpos >= m["ic"]:
                    continue

                face_util=S["face_count"]/max(1,S["target_faces"])
                ground_util=S["ground_count"]/max(1,S["target_ground"])
                rem=seg["end"]-endpos

                balance=(ground_util if is_ground else face_util)*1000.0
                score=balance + face_util*100.0 + rem*0.001
                candidates.append((score,src,si,k,L,base))

        if not candidates:
            raise RuntimeError("could not pack strip mat=%s faces=%d"%
                               (st["mat"],len(st["faces"])))

        _,src,si,k,L,base=min(candidates)
        S=state[src]
        seg=S["segments"][si]
        p=seg["cursor"]
        A=st["seq"][0]
        last=st["seq"][-1]

        # Isolated no-FFFF strip block:
        # A A [A] B C ... L L
        for j in range(k):
            struct.pack_into(">H",data,S["mesh"]["ib"]+2*(p+j),0)  # patched after remap
        raw_start=p+k
        for j,g in enumerate(st["seq"][1:]):
            struct.pack_into(">H",data,S["mesh"]["ib"]+2*(raw_start+j),0)
        suffix=raw_start+len(st["seq"])-1
        struct.pack_into(">H",data,S["mesh"]["ib"]+2*suffix,0)
        struct.pack_into(">H",data,S["mesh"]["ib"]+2*(suffix+1),0)

        S["blocks"].append({
            "strip":st,"cursor":p,"prefix":k,"base":base,"length":L
        })
        seg["cursor"] += L
        S["usedv"].update(stv)
        S["face_count"] += len(st["faces"])
        if is_ground:
            S["ground_count"] += len(st["faces"])

        h=seg["h"]
        for j,fi in enumerate(st["faces"]):
            low=base+j
            face_map[fi]=(src,(h<<16)|low,low)

    if len(face_map)!=len(faces):
        raise RuntimeError("face packing incomplete")

    # Finalize vertex remap and rewrite the temporary zero placeholders.
    for src in ORDER:
        S=state[src]
        m=S["mesh"]
        order=sorted(S["usedv"])
        rem={g:i for i,g in enumerate(order)}

        # Preserve original per-vertex shader payload for now; only XYZ is custom.
        attr=bytes(original[m["vb"]+12:m["vb"]+m["stride"]])
        for li,g in enumerate(order):
            o=m["vb"]+li*m["stride"]
            struct.pack_into(">3f",data,o,*verts[g])
            data[o+12:o+m["stride"]]=attr
        for li in range(len(order),m["vc"]):
            o=m["vb"]+li*m["stride"]
            struct.pack_into(">3f",data,o,0.0,0.0,0.0)
            data[o+12:o+m["stride"]]=attr

        for B in S["blocks"]:
            st=B["strip"]
            p=B["cursor"]
            k=B["prefix"]
            # prefix repeated A
            a=rem[st["seq"][0]]
            for j in range(k):
                struct.pack_into(">H",data,m["ib"]+2*(p+j),a)

            raw_start=p+k
            for j,g in enumerate(st["seq"][1:]):
                struct.pack_into(">H",data,m["ib"]+2*(raw_start+j),rem[g])

            last=rem[st["seq"][-1]]
            suffix=raw_start+len(st["seq"])-1
            struct.pack_into(">H",data,m["ib"]+2*suffix,last)
            struct.pack_into(">H",data,m["ib"]+2*(suffix+1),last)

        # Identity placement: user's scaled OBJ is already in desired mplobby coords.
        fids=[fi for fi,(ss,_,_) in face_map.items() if ss==src]
        mn=[min(infos[fi][2][a] for fi in fids) for a in range(3)]
        mx=[max(infos[fi][3][a] for fi in fids) for a in range(3)]

        bo=b0off+S["b0"]*0x70
        struct.pack_into(">3f",data,bo+4,0.0,0.0,0.0)
        struct.pack_into(">9f",data,bo+0x10,
                         1.0,0.0,0.0,
                         0.0,1.0,0.0,
                         0.0,0.0,1.0)

        oo=v3.OBJECT50_BASE+S["obj50"]*v3.OBJECT50_STRIDE
        struct.pack_into(">3f",data,oo,*mn)
        struct.pack_into(">3f",data,oo+0x10,*mx)

    # Every real rendered triangle now has a recovered source shape key.
    bysrc=defaultdict(list)
    for fi,f in enumerate(faces):
        src,key,p=face_map[fi]
        area,any_,mn,mx=infos[fi]
        bysrc[src].append({
            "fi":fi,"key":key,"mn":mn,"mx":mx,
            "prio":v3.priority(f,infos[fi]),"mat":f[3],
            "area":area,"any":any_,
        })

    chosen={}
    srcstats={}
    for src in ORDER:
        cap=v3.u32(original,mopps[src]+0x18)
        subset,ci,code=v3.choose_fit(bysrc[src],cap)
        v3.patch_mopp(data,mopps[src],ci,code)
        chosen[src]=subset
        srcstats[src]=(ci,code,cap)

    # Aggregate only the 4 custom placements.
    eligible=[]
    for i in range(b0c):
        fl=v3.u32(data,b0off+i*0x70+0x6C)
        if (fl & 0x4C7)==0:
            eligible.append(i)
    aggkeys=[eligible.index(SOURCES[s]["b0"]) for s in ORDER]

    allrecs=[r for src in ORDER for r in chosen[src]]
    agginfo=v3.make_code_info(allrecs)
    aggcode=v3.union_codes([term(k) for k in aggkeys])
    v3.patch_mopp(data,mopps[316],agginfo,aggcode)

    # MOPP validation.
    misses=[]
    for src in ORDER:
        ci,code,cap=srcstats[src]
        for r in chosen[src]:
            f=faces[r["fi"]]
            p=tuple(sum(verts[f[j]][a] for j in range(3))/3.0 for a in range(3))
            em,_=v3.eval_generated(code,ci,p,0.02)
            if r["key"] not in em:
                misses.append((src,r["fi"],r["key"]))
                if len(misses)>20:
                    break

    # Real-GPU-style strip validation directly from the generated IBs.
    # Compare unordered vertex triples so winding does not hide topology errors.
    original_tris={}
    for fi,f in enumerate(faces):
        original_tris[fi]=tuple(sorted(f[:3]))

    decoded=[]
    for src in ORDER:
        S=state[src]
        m=S["mesh"]
        idx=[struct.unpack_from(">H",data,m["ib"]+2*i)[0] for i in range(m["ic"])]
        local_to_global=sorted(S["usedv"])
        for a,b,c in standard_strip_faces(idx):
            if a>=len(local_to_global) or b>=len(local_to_global) or c>=len(local_to_global):
                continue
            decoded.append(tuple(sorted((
                local_to_global[a],local_to_global[b],local_to_global[c]
            ))))

    want=defaultdict(int)
    got=defaultdict(int)
    for t in original_tris.values(): want[t]+=1
    for t in decoded: got[t]+=1
    exact=sum(min(n,got[t]) for t,n in want.items())
    extra=sum(max(0,n-want[t]) for t,n in got.items())

    # Hard assertion: no 0xFFFF in ANY serialized render IB.
    ffff=0
    for m in meshes:
        if m["ib"] is None:
            continue
        for i in range(m["ic"]):
            if struct.unpack_from(">H",data,m["ib"]+2*i)[0] == 0xFFFF:
                ffff += 1

    if exact != len(faces) or extra != 0:
        raise RuntimeError("standard strip validation failed exact=%d/%d extra=%d"%
                           (exact,len(faces),extra))
    if ffff:
        raise RuntimeError("v7 still contains %d render-IB FFFF indices"%ffff)

    Path(out_path).write_bytes(data)

    mats=defaultdict(int)
    for src in ORDER:
        for r in chosen[src]:
            mats[r["mat"]]+=1

    lines=[
        "Blood Gulch SR1 v7 - NO 0xFFFF + degenerate strip stitching",
        "============================================================",
        f"OBJ vertices: {len(verts)}",
        f"OBJ triangles: {len(faces)}",
        f"Material-local strips: {len(strips)}",
        f"Old render IBs cleared with index 0: {cleared}",
        f"0xFFFF indices remaining in ALL render IBs: {ffff}",
        "",
        "Real triangle-strip topology validation:",
        f"  exact OBJ triangle matches: {exact}/{len(faces)}",
        f"  extra non-degenerate bridge triangles: {extra}",
        "",
        "Visual/collision source distribution:"
    ]
    for src in ORDER:
        S=state[src]
        ci,code,cap=srcstats[src]
        lines.append(
            f"  src {src} B0 {S['b0']}: faces={S['face_count']}, "
            f"ground={S['ground_count']}, uniqueVerts={len(S['usedv'])}/{S['mesh']['vc']}, "
            f"collisionSelected={len(chosen[src])}, MOPP={len(code)}/{cap}"
        )

    lines += [
        "",
        f"Total collision triangles selected: {sum(len(chosen[s]) for s in ORDER)}/{len(faces)}",
        f"blood_ground selected: {mats['blood_ground']}/2433",
        f"MOPP centroid validation misses: {len(misses)}",
        f"Aggregate keys: {aggkeys}",
        "",
        "Collision by material:"
    ]
    for mat,n in sorted(mats.items(),key=lambda x:-x[1]):
        lines.append(f"  {mat}: {n}")

    lines += [
        "",
        "Critical v7 changes:",
        "- NO render index buffer uses 0xFFFF.",
        "- Old mplobby meshes are hidden using zero-index degenerate strips.",
        "- Custom Blood Gulch strips are separated only with repeated valid vertices.",
        "- Each imported strip stays inside a recovered Havok source-key segment.",
        "- Existing SR1 vertex attribute bytes/materials are still reused; normals/UVs are the next issue."
    ]

    Path(report_path).write_text("\n".join(lines),encoding="utf-8")
    print("\n".join(lines))

if __name__=="__main__":
    if len(sys.argv)!=5:
        print("usage: obj_to_sr1_bbchunk_fullreplace_collision_v7_noffff.py input.obj template.bbchunk output.bbchunk report.txt")
        raise SystemExit(2)
    main(*sys.argv[1:])
