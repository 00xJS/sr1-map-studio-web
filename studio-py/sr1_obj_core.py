#!/usr/bin/env python3
# Saints Row 1 Xbox 360 arbitrary OBJ -> BBChunk
# v13 PACKFIX5: automatic capacity-aware spatial donor assignment + recovered class-2 vertex attributes.
#
# New in v12:
#   * OBJ vertices are split by (v,vt,vn), preserving UV seams and hard normals.
#   * Writes recovered SR1 class-2 vertex format instead of cloning donor bytes:
#       +0x00 float3 position (big endian)
#       +0x0C DEC3N normal
#       +0x10 DEC3N tangent + signed handedness in bits 30..31
#       +0x14 short2 UV0 fixed point (1/1024)
#       +0x18... extra UV channels, controlled by copy/zero policy
#   * Tangents are rebuilt from position + UV0 and orthogonalized to the OBJ normal.
#
# Usage:
#   python obj_to_sr1_bbchunk_spatial_chunks_v12_vertexattrs.py \
#       input.obj template.bbchunk_xbox2 output.bbchunk_xbox2 report.txt [copy|zero]

from pathlib import Path
from collections import defaultdict, Counter
import importlib.util, struct, math, sys, json

HERE = Path(__file__).resolve().parent
V3 = HERE / "obj_to_sr1_bbchunk_fullreplace_collision_v3.py"
V7 = HERE / "obj_to_sr1_bbchunk_fullreplace_collision_v7_noffff.py"

spec = importlib.util.spec_from_file_location("sr1v3", V3)
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)

spec = importlib.util.spec_from_file_location("sr1v7", V7)
v7 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v7)

SOURCES = {
    64:(133,125), 65:(134,126), 66:(135,127), 67:(136,128),
    68:(137,129), 69:(138,130), 70:(139,131), 71:(140,132),
    72:(141,133), 73:(142,134), 74:(143,135), 75:(144,136),
}

TILE_SOURCE = {
    # PACKFIX4:
    # v13 expands OBJ corners by (v,vt,vn), which creates more native vertices
    # and shorter material-local strips around UV/hard-normal seams.
    #
    # The original v10 assignment put the relatively demanding center-right
    # tile (2,1) on source 72, whose donor mesh has only 1308 vertex slots and
    # comparatively tight recovered index/key spans.  Source 67 is much larger
    # (2433 vertex slots) and was carrying the lighter tile (1,0).
    #
    # Swap those two donor sources.  Origins/AABBs/MOPPs are rebuilt below, so
    # donor source IDs do not need to stay tied to their original world region.
    (0,0):64, (1,0):72, (2,0):70, (3,0):65,
    (0,1):68, (1,1):75, (2,1):67, (3,1):74,
    (0,2):73, (1,2):71, (2,2):66, (3,2):69,
}

NX = 4
NZ = 3
OBJECT50_BASE = v3.OBJECT50_BASE
OBJECT50_STRIDE = v3.OBJECT50_STRIDE
EPS = 1.0e-20


def term(k):
    if k <= 0xFF:
        return bytes((0x50,k))
    return bytes((0x51,(k>>8)&255,k&255))


def standard_strip_faces(idx):
    out=[]
    for end in range(2,len(idx)):
        a,b,c=idx[end-2],idx[end-1],idx[end]
        if a==b or b==c or a==c:
            continue
        if ((end-2)&1):
            a,b=b,a
        out.append((a,b,c))
    return out


def tile_faces_for_obj(verts,faces):
    minx=min(v[0] for v in verts); maxx=max(v[0] for v in verts)
    minz=min(v[2] for v in verts); maxz=max(v[2] for v in verts)
    dx=maxx-minx
    dz=maxz-minz

    # Always return all 12 logical cells. Real maps do not necessarily have
    # triangles in every rectangular grid cell (Blood Gulch is a good example),
    # and an empty cell is perfectly valid: its donor render mesh stays cleared
    # and it is omitted from the aggregate collision tree.
    out={tid:[] for tid in TILE_SOURCE}
    for fi,f in enumerate(faces):
        cx=sum(verts[f[j]][0] for j in range(3))/3.0
        cz=sum(verts[f[j]][2] for j in range(3))/3.0
        fx=0.0 if abs(dx)<=EPS else (cx-minx)/dx
        fz=0.0 if abs(dz)<=EPS else (cz-minz)/dz
        ix=min(NX-1,max(0,int(fx*NX)))
        iz=min(NZ-1,max(0,int(fz*NZ)))
        out[(ix,iz)].append(fi)
    return out


def tile_world_bounds(infos,fids):
    mn=[min(infos[fi][2][a] for fi in fids) for a in range(3)]
    mx=[max(infos[fi][3][a] for fi in fids) for a in range(3)]
    return mn,mx


def tile_origin(infos,fids):
    mn,mx=tile_world_bounds(infos,fids)
    return tuple((mn[a]+mx[a])*0.5 for a in range(3))


def build_tile_strips(faces,fids):
    local_faces=[faces[fi] for fi in fids]
    strips=v7.material_stripify(local_faces)
    for st in strips:
        st["faces_global"]=[fids[j] for j in st["faces"]]
    return strips


def pack_tile(source, strips, segs, mesh):
    """
    Pack one spatial tile into the donor source's recovered index/key spans.

    PACKFIX3 changes:
      * retain the 6-index compact layout for isolated triangles;
      * avoid leaving unusable 1..5-index tails whenever possible;
      * use a dynamic "hardest strip first" pass (fewest legal placements);
      * automatically retry with deterministic alternate strip orders.

    Material grouping is NOT required here because v13's material_map.json
    records the material for each emitted block independently.
    """

    def compact_single_triangle(st,p):
        # A one-face strip can always be represented in 6 indices.
        #
        # Generic layout may require 7 depending on cursor parity.  When p is
        # even, reverse the stored winding once; strip parity reverses it again
        # during decoding/rendering, restoring the original A,B,C winding.
        if len(st.get("faces",[])) != 1 or len(st.get("seq",[])) != 3:
            return None

        st2=st
        if (p & 1) == 0:
            st2=dict(st)
            q=list(st["seq"])
            q[0],q[1]=q[1],q[0]
            st2["seq"]=q

        return st2,2,6,p+1

    def options_for(st,cur_segs):
        opts=[]

        for si,seg in enumerate(cur_segs):
            p=seg["cursor"]

            # Proven generic v7 no-FFFF layout.
            k,L,base=v7.block_layout(p,st)
            end=p+L-1
            if end <= seg["end"] and end < mesh["ic"]:
                rem=seg["end"]-end

                # Tail desirability:
                #   0 = exact fill (best)
                #   1 = leaves >=6, still usable by any compact triangle
                #   2 = leaves 1..5, permanently unusable fragment
                tail_class = 0 if rem == 0 else (1 if rem >= 6 else 2)

                opts.append((
                    tail_class,
                    rem,
                    0,      # prefer generic layout on otherwise equal score
                    si,p,k,L,base,st
                ))

            # Compact isolated-triangle layout.
            compact=compact_single_triangle(st,p)
            if compact is not None:
                st2,ck,cL,cbase=compact
                cend=p+cL-1
                if cend <= seg["end"] and cend < mesh["ic"]:
                    rem=seg["end"]-cend
                    tail_class = 0 if rem == 0 else (1 if rem >= 6 else 2)

                    opts.append((
                        tail_class,
                        rem,
                        1,
                        si,p,ck,cL,cbase,st2
                    ))

        return opts

    def diagnostic(st,cur_segs):
        free=[]
        requirements=[]

        for si,seg in enumerate(cur_segs):
            p=seg["cursor"]
            k,L,base=v7.block_layout(p,st)
            compact=compact_single_triangle(st,p)
            compact_L=compact[2] if compact is not None else None

            remaining=max(0,seg["end"]-p+1)
            free.append((si,remaining,p,seg["end"]))
            requirements.append((si,L,compact_L,p))

        return {
            "strip": st,
            "free": free,
            "requirements": requirements,
            "total_free": sum(x[1] for x in free),
            "max_free": max([x[1] for x in free] or [0]),
        }

    def run_fixed_order(work):
        cur=[dict(s) for s in segs]
        blocks=[]

        for st in work:
            opts=options_for(st,cur)
            if not opts:
                return None, diagnostic(st,cur)

            # Prefer exact fill, then viable tails, then unavoidable 1..5 waste.
            # Within a class, tighter fit wins.
            _,_,_,si,p,k,L,base,placed_st=min(opts)
            blocks.append((placed_st,si,p,k,L,base))
            cur[si]["cursor"] += L

        return blocks,None

    def run_hardest_first():
        cur=[dict(s) for s in segs]
        remaining=list(strips)
        blocks=[]

        while remaining:
            ranked=[]
            first_failure=None

            for ri,st in enumerate(remaining):
                opts=options_for(st,cur)

                if not opts:
                    first_failure=diagnostic(st,cur)
                    # Do not immediately abort: another strip might consume a
                    # span in a way that changes parity beneficially.  Give
                    # zero-option strips top priority only if no move can make
                    # progress; normal cursor movement only advances, though,
                    # so this is mostly for clear diagnostics.
                    ranked.append((0, -len(st.get("seq",[])), ri, st, opts))
                    continue

                # Count unique donor segments that can currently accept it.
                fit_segments=len(set(o[3] for o in opts))

                # Constraint-first: fewer possible segments = harder.
                # Tie-break by larger strips first.
                ranked.append((
                    fit_segments,
                    -len(st.get("seq",[])),
                    ri,st,opts
                ))

            ranked.sort(key=lambda x:(x[0],x[1],str(x[3].get("mat",""))))
            fit_count,_,ri,st,opts=ranked[0]

            if not opts:
                return None, diagnostic(st,cur)

            # Among legal placements, avoid creating dead tails.
            _,_,_,si,p,k,L,base,placed_st=min(opts)
            blocks.append((placed_st,si,p,k,L,base))
            cur[si]["cursor"] += L
            del remaining[ri]

        return blocks,None

    failures=[]

    # Attempt 1: dynamic constraint/hardest-first placement.
    blocks,fail=run_hardest_first()
    if blocks is not None:
        return blocks
    failures.append(("hardest-first",fail))

    # Attempt 2: largest first, but with waste-aware placement.
    work=sorted(
        strips,
        key=lambda s:(-len(s.get("seq",[])), str(s.get("mat","")))
    )
    blocks,fail=run_fixed_order(work)
    if blocks is not None:
        return blocks
    failures.append(("largest-first",fail))

    # Attempt 3: isolated triangles first.  This deliberately reserves exact
    # 6-slot opportunities before larger strips can turn them into 1..5 scraps.
    work=sorted(
        strips,
        key=lambda s:(
            0 if (len(s.get("faces",[]))==1 and len(s.get("seq",[]))==3) else 1,
            -len(s.get("seq",[])),
            str(s.get("mat",""))
        )
    )
    blocks,fail=run_fixed_order(work)
    if blocks is not None:
        return blocks
    failures.append(("single-triangles-first",fail))

    # All heuristics failed: report the most informative final state.
    mode,fail=max(
        failures,
        key=lambda x:(x[1]["total_free"],x[1]["max_free"])
    )
    st=fail["strip"]

    raise RuntimeError(
        "source %d cannot pack strip after %d strategies; "
        "best-failure-mode=%s mat=%r seqVerts=%d faces=%d; "
        "max contiguous free=%d total free=%d; "
        "requirements(normal,compact)=%r; segments=%r" %
        (
            source,
            len(failures),
            mode,
            st.get("mat",""),
            len(st.get("seq",[])),
            len(st.get("faces",[])),
            fail["max_free"],
            fail["total_free"],
            fail["requirements"],
            fail["free"],
        )
    )


# -----------------------------------------------------------------------------
# OBJ + recovered vertex format
# -----------------------------------------------------------------------------

def _obj_index(s,n):
    if s is None or s == "":
        return None
    x=int(s)
    return x-1 if x>0 else n+x


def parse_obj_attrs(path):
    positions=[]
    texcoords=[]
    normals=[]
    raw_faces=[]
    mat="(default)"

    for raw in Path(path).open("r",encoding="utf-8",errors="ignore"):
        line=raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("v "):
            p=line.split()
            positions.append((float(p[1]),float(p[2]),float(p[3])))
        elif line.startswith("vt "):
            p=line.split()
            texcoords.append((float(p[1]),float(p[2])))
        elif line.startswith("vn "):
            p=line.split()
            normals.append((float(p[1]),float(p[2]),float(p[3])))
        elif line.startswith("usemtl "):
            mat=line.split(None,1)[1]
        elif line.startswith("f "):
            corners=[]
            for tok in line.split()[1:]:
                q=tok.split("/")
                vi=_obj_index(q[0],len(positions))
                ti=_obj_index(q[1],len(texcoords)) if len(q)>1 else None
                ni=_obj_index(q[2],len(normals)) if len(q)>2 else None
                corners.append((vi,ti,ni))
            for i in range(1,len(corners)-1):
                raw_faces.append((corners[0],corners[i],corners[i+1],mat))

    # SR1 needs one normal/UV tuple per native vertex. OBJ does not: one position
    # can be referenced by several vt/vn values. Split by the complete corner key.
    corner_to_id={}
    corner_keys=[]
    verts=[]
    uv0=[]
    src_normals=[]

    def native_id(c):
        if c in corner_to_id:
            return corner_to_id[c]
        vi,ti,ni=c
        if vi is None or not (0 <= vi < len(positions)):
            raise RuntimeError("OBJ face references an invalid position index")
        gid=len(corner_keys)
        corner_to_id[c]=gid
        corner_keys.append(c)
        verts.append(positions[vi])
        uv0.append(texcoords[ti] if ti is not None and 0 <= ti < len(texcoords) else None)
        src_normals.append(normals[ni] if ni is not None and 0 <= ni < len(normals) else None)
        return gid

    faces=[]
    for a,b,c,m in raw_faces:
        faces.append((native_id(a),native_id(b),native_id(c),m))

    return {
        "positions_raw":positions,
        "texcoords_raw":texcoords,
        "normals_raw":normals,
        "corner_keys":corner_keys,
        "verts":verts,
        "uv0":uv0,
        "src_normals":src_normals,
        "faces":faces,
    }


def orient_faces_to_source_normals(obj):
    """Match OBJ triangle winding to the authored corner normals.

    Caboose's working Beaver Creek has a strong invariant: decoded strip
    triangles and packed vertex normals point to the same side.  Some Halo OBJ
    exporters can preserve normals while reversing face winding during a
    coordinate-system conversion.  That looks fine in a two-sided editor but
    produces inverted lighting/backface behavior in SR1.

    For every non-degenerate face that has at least one source normal, compare
    the geometric face normal to the average authored corner normal.  If they
    oppose each other, reverse B/C for that face.  UV and hard-normal seams are
    already split into native vertices, so this is safe.
    """
    verts=obj["verts"]
    src=obj.get("src_normals") or [None]*len(verts)
    out_faces=[]
    checked=flipped=degenerate=0
    pre=[]
    post=[]
    for f in obj["faces"]:
        a,b,c,mat=f
        p0,p1,p2=verts[a],verts[b],verts[c]
        gn=vcross(vsub(p1,p0),vsub(p2,p0))
        if vlen(gn) <= EPS:
            degenerate += 1
            out_faces.append(f)
            continue
        ns=[]
        for i in (a,b,c):
            n=src[i] if 0 <= i < len(src) else None
            if n is not None and vlen(n) > EPS:
                ns.append(vnorm(n))
        if not ns:
            out_faces.append(f)
            continue
        navg=vnorm(tuple(sum(n[k] for n in ns) for k in range(3)))
        gnorm=vnorm(gn)
        d=vdot(gnorm,navg)
        checked += 1
        pre.append(d)
        if d < 0.0:
            out_faces.append((a,c,b,mat))
            flipped += 1
            post.append(-d)
        else:
            out_faces.append(f)
            post.append(d)
    out=dict(obj)
    out["faces"]=out_faces
    def mean(xs): return sum(xs)/len(xs) if xs else 0.0
    stats={
        "faces_total":len(obj["faces"]),
        "faces_checked":checked,
        "faces_flipped":flipped,
        "degenerate_faces":degenerate,
        "pre_negative":sum(1 for x in pre if x < 0.0),
        "pre_mean_alignment":mean(pre),
        "post_mean_alignment":mean(post),
        "post_min_alignment":min(post) if post else 0.0,
    }
    return out,stats


def vadd(a,b): return (a[0]+b[0],a[1]+b[1],a[2]+b[2])
def vsub(a,b): return (a[0]-b[0],a[1]-b[1],a[2]-b[2])
def vmul(a,s): return (a[0]*s,a[1]*s,a[2]*s)
def vdot(a,b): return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]
def vcross(a,b): return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def vlen(a): return math.sqrt(max(0.0,vdot(a,a)))


def vnorm(a,fallback=(0.0,1.0,0.0)):
    L=vlen(a)
    if L <= EPS or not math.isfinite(L):
        return fallback
    return (a[0]/L,a[1]/L,a[2]/L)


def fallback_tangent(n):
    # Cross against the least-parallel axis.
    ax=(1.0,0.0,0.0)
    ay=(0.0,1.0,0.0)
    az=(0.0,0.0,1.0)
    axis=min((ax,ay,az),key=lambda a:abs(vdot(n,a)))
    return vnorm(vcross(axis,n),(1.0,0.0,0.0))


def build_vertex_frames(verts,faces,uv0,src_normals):
    nacc=[(0.0,0.0,0.0) for _ in verts]
    tacc=[(0.0,0.0,0.0) for _ in verts]
    bacc=[(0.0,0.0,0.0) for _ in verts]
    deg_uv=0

    for f in faces:
        ia,ib,ic=f[:3]
        p0,p1,p2=verts[ia],verts[ib],verts[ic]
        e1=vsub(p1,p0); e2=vsub(p2,p0)
        gn=vcross(e1,e2)
        for i in (ia,ib,ic):
            nacc[i]=vadd(nacc[i],gn)

        w0,w1,w2=uv0[ia],uv0[ib],uv0[ic]
        if w0 is None or w1 is None or w2 is None:
            deg_uv += 1
            continue
        du1=w1[0]-w0[0]; dv1=w1[1]-w0[1]
        du2=w2[0]-w0[0]; dv2=w2[1]-w0[1]
        det=du1*dv2-du2*dv1
        if abs(det) <= 1.0e-12:
            deg_uv += 1
            continue
        r=1.0/det
        t=(
            (e1[0]*dv2-e2[0]*dv1)*r,
            (e1[1]*dv2-e2[1]*dv1)*r,
            (e1[2]*dv2-e2[2]*dv1)*r,
        )
        b=(
            (e2[0]*du1-e1[0]*du2)*r,
            (e2[1]*du1-e1[1]*du2)*r,
            (e2[2]*du1-e1[2]*du2)*r,
        )
        for i in (ia,ib,ic):
            tacc[i]=vadd(tacc[i],t)
            bacc[i]=vadd(bacc[i],b)

    frames=[]
    sign_counts=Counter()
    src_normal_count=0
    fallback_tangent_count=0
    max_abs_ndott=0.0

    for i in range(len(verts)):
        sn=src_normals[i]
        if sn is not None and vlen(sn)>EPS:
            n=vnorm(sn)
            src_normal_count += 1
        else:
            n=vnorm(nacc[i])

        # Gram-Schmidt tangent against the chosen normal.
        t=vsub(tacc[i],vmul(n,vdot(n,tacc[i])))
        if vlen(t)<=EPS:
            t=fallback_tangent(n)
            fallback_tangent_count += 1
        else:
            t=vnorm(t)

        # Recovered SR1 convention:
        #     bitangent = cross(tangent, normal) * tangent_sign
        cb=vcross(t,n)
        sign=1 if vdot(cb,bacc[i]) >= 0.0 else -1
        sign_counts[sign] += 1
        max_abs_ndott=max(max_abs_ndott,abs(vdot(n,t)))
        frames.append((n,t,sign))

    return frames,{
        "degenerate_uv_faces":deg_uv,
        "source_normals_used":src_normal_count,
        "fallback_tangents":fallback_tangent_count,
        "sign_positive":sign_counts[1],
        "sign_negative":sign_counts[-1],
        "max_abs_n_dot_t":max_abs_ndott,
    }


def _q10(x):
    x=max(-1.0,min(1.0,float(x)))
    q=int(round(x*511.0))
    q=max(-511,min(511,q))
    return q & 0x3FF


def pack_dec3n(v,top2=0):
    return (_q10(v[0]) | (_q10(v[1])<<10) | (_q10(v[2])<<20) |
            ((top2 & 3)<<30))


def pack_tangent(v,sign):
    top2=1 if sign>=0 else 3
    return pack_dec3n(v,top2)


def _q16_uv(x):
    q=int(round(float(x)*1024.0))
    return max(-32768,min(32767,q))


def write_class2_vertex(data,o,stride,uv_count,pos,frame,uv,extra_uv_policy):
    expected=20+uv_count*4
    if stride != expected:
        raise RuntimeError("class-2 stride mismatch: stride=%d expected=%d"%(stride,expected))
    n,t,sign=frame
    struct.pack_into(">3f",data,o,*pos)
    struct.pack_into(">I",data,o+0x0C,pack_dec3n(n,0))
    struct.pack_into(">I",data,o+0x10,pack_tangent(t,sign))

    base_uv=uv if uv is not None else (0.0,0.0)
    for ch in range(uv_count):
        if ch==0 or extra_uv_policy=="copy":
            q=base_uv
        elif extra_uv_policy=="zero":
            q=(0.0,0.0)
        else:
            raise RuntimeError("unknown extra UV policy: %s"%extra_uv_policy)
        struct.pack_into(">hh",data,o+0x14+ch*4,_q16_uv(q[0]),_q16_uv(q[1]))


def decode_dec3n_word(w):
    def s10(x):
        x &= 0x3FF
        return x-0x400 if (x & 0x200) else x
    return (s10(w)/511.0,s10(w>>10)/511.0,s10(w>>20)/511.0),(w>>30)&3


def main(obj_path,template_path,out_path,report_path,extra_uv_policy="copy",material_map_path=None):
    if extra_uv_policy not in ("copy","zero"):
        raise RuntimeError("extra UV policy must be copy or zero")

    obj=parse_obj_attrs(obj_path)
    verts=obj["verts"]
    faces=obj["faces"]
    uv0=obj["uv0"]
    frames,frame_stats=build_vertex_frames(verts,faces,uv0,obj["src_normals"])
    infos=[v3.tri_info(verts,f) for f in faces]
    if not verts or not faces:
        raise RuntimeError("empty OBJ")

    original=bytearray(Path(template_path).read_bytes())
    data=bytearray(original)
    a4c,b0c,b0off,meshes=v3.parse_template(data)
    mopps=v3.mopp_positions(original)
    if len(mopps) < 317:
        raise RuntimeError("expected at least 317 MOPP blobs")

    tiles=tile_faces_for_obj(verts,faces)

    # ------------------------------------------------------------------
    # PACKFIX5: choose tile -> donor-source mapping from the ACTUAL v13
    # (v,vt,vn)-split geometry instead of a fixed v10-era assignment.
    #
    # A candidate pair is accepted only when ALL of these are true:
    #   1) donor vertex capacity can hold the tile's split native vertices;
    #   2) pack_tile() can fit all material-local strips in the donor's
    #      recovered collision/index-key spans;
    #   3) the generated per-source MOPP fits the donor's serialized budget.
    #
    # Then a small backtracking solver makes a one-to-one assignment of the
    # 12 tiles to sources 64..75, preferring the tightest adequate donor.
    # ------------------------------------------------------------------
    tile_pre={}
    candidate_cache={}
    candidate_sources={}

    grid_tiles=sorted(TILE_SOURCE,key=lambda t:(t[1],t[0]))
    source_ids=sorted(SOURCES)

    for tid in grid_tiles:
        fids=tiles.get(tid,[])
        strips=build_tile_strips(faces,fids) if fids else []

        used_global=set()
        for fi in fids:
            used_global.update(faces[fi][:3])

        if fids:
            origin=tile_origin(infos,fids)
            worldmn,worldmx=tile_world_bounds(infos,fids)
        else:
            origin=(0.0,0.0,0.0)
            worldmn=(0.0,0.0,0.0)
            worldmx=(0.0,0.0,0.0)

        tile_pre[tid]={
            "fids":fids,
            "strips":strips,
            "used_global":used_global,
            "origin":origin,
            "worldmn":worldmn,
            "worldmx":worldmx,
        }

    def evaluate_pair(tid,src):
        T=tile_pre[tid]
        fids=T["fids"]
        strips=T["strips"]
        used_global=T["used_global"]
        origin=T["origin"]

        m=meshes[src]
        d=m["desc"]
        uv_count=v3.u16(original,d+0x12)
        vertex_class=v3.u16(original,d+0x14)

        if vertex_class != 2:
            return None,"vertex class %d"%vertex_class
        if m["stride"] != 20+uv_count*4:
            return None,"class-2 stride/UV mismatch"

        if len(used_global) > m["vc"]:
            return None,"vertex overflow %d>%d"%(len(used_global),m["vc"])

        # Empty spatial cells can use any otherwise-valid donor.
        if not fids:
            cap=v3.u32(original,mopps[src]+0x18)
            return {
                "score":(m["vc"],cap,m["ic"]),
                "vertex_spare":m["vc"],
                "mopp_spare":cap,
                "index_spare":m["ic"],
            },None

        segs,oldkeys=v3.derive_segments(original,mopps,src)
        if not segs:
            return None,"no recovered collision key spans"

        try:
            blocks=pack_tile(src,strips,segs,m)
        except RuntimeError as e:
            return None,"index/span pack failed: %s"%e

        # Build exactly the records that the real writer will use so MOPP
        # capacity is part of assignment compatibility, not a later surprise.
        records=[]
        for st,si,p,k,L,base in blocks:
            h=segs[si]["h"]
            for j,gfi in enumerate(st["faces_global"]):
                key=(h<<16)|(base+j)
                area,any_,mnw,mxw=infos[gfi]
                mnl=tuple(mnw[a]-origin[a] for a in range(3))
                mxl=tuple(mxw[a]-origin[a] for a in range(3))
                records.append({
                    "fi":gfi,
                    "key":key,
                    "mn":mnl,
                    "mx":mxl,
                    "prio":v3.priority(faces[gfi],infos[gfi]),
                    "mat":faces[gfi][3],
                    "area":area,
                    "any":any_,
                })

        if len(records) != len(fids):
            return None,"collision assignment %d/%d"%(len(records),len(fids))

        ci,code=v3.compile_mopp([dict(r) for r in records])
        cap=v3.u32(original,mopps[src]+0x18)
        if len(code) > cap:
            return None,"MOPP overflow %d>%d"%(len(code),cap)

        used_indices=sum(B[4] for B in blocks)
        index_spare=max(0,m["ic"]-used_indices)
        vertex_spare=m["vc"]-len(used_global)
        mopp_spare=cap-len(code)

        # Prefer the tightest donor that safely fits, preserving large donors
        # for tiles that have fewer options.
        score=(vertex_spare,mopp_spare,index_spare,m["vc"])

        return {
            "score":score,
            "vertex_spare":vertex_spare,
            "mopp_spare":mopp_spare,
            "index_spare":index_spare,
        },None

    print("PACKFIX5 automatic donor assignment")
    print("  Measuring actual split-vertex / strip / MOPP demand...")

    rejected={}
    for tid in grid_tiles:
        candidate_sources[tid]=[]
        rejected[tid]={}

        for src in source_ids:
            C,why=evaluate_pair(tid,src)
            if C is None:
                rejected[tid][src]=why
                continue
            candidate_cache[(tid,src)]=C
            candidate_sources[tid].append(src)

        T=tile_pre[tid]
        print(
            "  tile %r: faces=%d splitVerts=%d strips=%d compatible=%r"%
            (
                tid,
                len(T["fids"]),
                len(T["used_global"]),
                len(T["strips"]),
                candidate_sources[tid],
            )
        )

        if not candidate_sources[tid]:
            details="; ".join(
                "src%d: %s"%(s,rejected[tid].get(s,"rejected"))
                for s in source_ids
            )
            raise RuntimeError(
                "PACKFIX5: tile %r has no compatible donor source. %s"%
                (tid,details)
            )

    def solve_assignment(assigned,used_sources):
        if len(assigned)==len(grid_tiles):
            return dict(assigned)

        remaining=[t for t in grid_tiles if t not in assigned]

        # Dynamic minimum-remaining-values choice: assign the tile with the
        # fewest still-unused compatible donors first.
        def avail_for(t):
            return [s for s in candidate_sources[t] if s not in used_sources]

        tid=min(
            remaining,
            key=lambda t:(
                len(avail_for(t)),
                -len(tile_pre[t]["used_global"]),
                -len(tile_pre[t]["fids"]),
            )
        )

        avail=avail_for(tid)
        if not avail:
            return None

        avail.sort(key=lambda s:candidate_cache[(tid,s)]["score"])

        for src in avail:
            assigned[tid]=src
            used_sources.add(src)

            # Cheap forward check before descending.
            viable=True
            for other in remaining:
                if other==tid:
                    continue
                if not any(
                    s not in used_sources
                    for s in candidate_sources[other]
                ):
                    viable=False
                    break

            if viable:
                solved=solve_assignment(assigned,used_sources)
                if solved is not None:
                    return solved

            used_sources.remove(src)
            del assigned[tid]

        return None

    tile_source=solve_assignment({},set())
    if tile_source is None:
        raise RuntimeError(
            "PACKFIX5: every tile has at least one compatible donor, "
            "but no one-to-one 12-source assignment exists"
        )

    print("PACKFIX5 selected assignment:")
    for tid in grid_tiles:
        src=tile_source[tid]
        C=candidate_cache[(tid,src)]
        print(
            "  tile %r -> src %d  "
            "(vertex spare=%d, MOPP spare=%d, index spare~%d)"%
            (
                tid,src,
                C["vertex_spare"],
                C["mopp_spare"],
                C["index_spare"],
            )
        )

    # Full visual replacement. Zero indices make every old strip degenerate.
    for m in meshes:
        if m["ib"] is not None:
            for i in range(m["ic"]):
                struct.pack_into(">H",data,m["ib"]+2*i,0)

    state={}
    inactive_tiles=[]
    face_to_collision={}
    class2_written=0
    uv_clamped=0

    for tid in sorted(tile_source,key=lambda t:(t[1],t[0])):
        src=tile_source[tid]
        b0,obj50=SOURCES[src]
        m=meshes[src]
        d=m["desc"]
        uv_count=v3.u16(original,d+0x12)
        vertex_class=v3.u16(original,d+0x14)
        if vertex_class != 2:
            raise RuntimeError("source %d is vertex class %d, expected class 2"%(src,vertex_class))
        if m["stride"] != 20+uv_count*4:
            raise RuntimeError("source %d class-2 stride/UV mismatch"%src)

        fids=tiles.get(tid,[])
        if not fids:
            inactive_tiles.append((tid,src,b0,obj50))
            # Render indices for this donor mesh were already zeroed above.
            # Do not compile an empty MOPP and, critically, do not include this
            # source in the aggregate collision tree below. That keeps old donor
            # collision unreachable while allowing genuinely empty spatial cells.
            continue

        strips=build_tile_strips(faces,fids)
        segs,oldkeys=v3.derive_segments(original,mopps,src)
        if not segs:
            raise RuntimeError("source %d has no recovered collision key spans"%src)

        used_global=set()
        for fi in fids:
            used_global.update(faces[fi][:3])
        if len(used_global) > m["vc"]:
            raise RuntimeError(
                "source %d tile %r vertex overflow %d>%d"%
                (src,tid,len(used_global),m["vc"])
            )

        blocks=pack_tile(src,strips,segs,m)
        origin=tile_origin(infos,fids)
        worldmn,worldmx=tile_world_bounds(infos,fids)

        # Local native vertex table. 'used_global' now contains expanded
        # (v,vt,vn) vertices, so UV seams and hard normals survive import.
        order=sorted(used_global)
        rem={g:i for i,g in enumerate(order)}

        for li,g in enumerate(order):
            o=m["vb"]+li*m["stride"]
            p=verts[g]
            local=(p[0]-origin[0],p[1]-origin[1],p[2]-origin[2])
            write_class2_vertex(
                data,o,m["stride"],uv_count,local,frames[g],uv0[g],extra_uv_policy
            )
            class2_written += 1
            if uv0[g] is not None:
                if abs(uv0[g][0]*1024.0)>32767 or abs(uv0[g][1]*1024.0)>32767:
                    uv_clamped += 1

        # Unused native capacity is never referenced; zero it deterministically.
        zero=bytes(m["stride"])
        for li in range(len(order),m["vc"]):
            o=m["vb"]+li*m["stride"]
            data[o:o+m["stride"]]=zero

        # Write isolated no-FFFF strips.
        records=[]
        written_positions=0
        for st,si,p,k,L,base in blocks:
            A=rem[st["seq"][0]]
            for j in range(k):
                struct.pack_into(">H",data,m["ib"]+2*(p+j),A)

            raw=p+k
            for j,g in enumerate(st["seq"][1:]):
                struct.pack_into(">H",data,m["ib"]+2*(raw+j),rem[g])

            last=rem[st["seq"][-1]]
            suffix=raw+len(st["seq"])-1
            struct.pack_into(">H",data,m["ib"]+2*suffix,last)
            struct.pack_into(">H",data,m["ib"]+2*(suffix+1),last)
            written_positions += L

            h=segs[si]["h"]
            for j,gfi in enumerate(st["faces_global"]):
                key=(h<<16)|(base+j)
                area,any_,mnw,mxw=infos[gfi]
                mnl=tuple(mnw[a]-origin[a] for a in range(3))
                mxl=tuple(mxw[a]-origin[a] for a in range(3))
                rec={
                    "fi":gfi,"key":key,"mn":mnl,"mx":mxl,
                    "prio":v3.priority(faces[gfi],infos[gfi]),
                    "mat":faces[gfi][3],"area":area,"any":any_,
                }
                records.append(rec)
                face_to_collision[gfi]=(src,key,origin)

        if len(records) != len(fids):
            raise RuntimeError("tile %r collision assignment mismatch"% (tid,))

        ci,code=v3.compile_mopp([dict(r) for r in records])
        cap=v3.u32(original,mopps[src]+0x18)
        if len(code) > cap:
            raise RuntimeError("source %d MOPP overflow %d>%d"%(src,len(code),cap))
        v3.patch_mopp(data,mopps[src],ci,code)

        bo=b0off+b0*0x70
        struct.pack_into(">3f",data,bo+4,*origin)
        struct.pack_into(">9f",data,bo+0x10,
                         1.0,0.0,0.0,
                         0.0,1.0,0.0,
                         0.0,0.0,1.0)

        oo=OBJECT50_BASE+obj50*OBJECT50_STRIDE
        struct.pack_into(">3f",data,oo,*worldmn)
        struct.pack_into(">3f",data,oo+0x10,*worldmx)

        maxdist=0.0
        for fi in fids:
            f=faces[fi]
            c=tuple(sum(verts[f[j]][a] for j in range(3))/3.0 for a in range(3))
            dist=math.sqrt(sum((c[a]-origin[a])**2 for a in range(3)))
            maxdist=max(maxdist,dist)

        state[src]={
            "tile":tid,"b0":b0,"obj50":obj50,"mesh":m,
            "fids":fids,"strips":strips,"blocks":blocks,
            "order":order,"origin":origin,"uv_count":uv_count,
            "worldmn":worldmn,"worldmx":worldmx,
            "records":records,"ci":ci,"code":code,"cap":cap,
            "written_positions":written_positions,"maxdist":maxdist,
        }

    if len(face_to_collision) != len(faces):
        raise RuntimeError(
            "not all OBJ triangles were assigned: %d/%d"%
            (len(face_to_collision),len(faces))
        )

    # Aggregate collision tree: emit only populated Blood Gulch B0 children.
    # Empty spatial cells are intentionally excluded so their untouched donor
    # source MOPPs cannot contribute stale collision.
    eligible=[]
    for i in range(b0c):
        fl=v3.u32(data,b0off+i*0x70+0x6C)
        if (fl & 0x4C7)==0:
            eligible.append(i)

    active_sources=sorted(state)
    aggkeys=[eligible.index(SOURCES[s][0]) for s in active_sources]
    agg_records=[]
    for src,S in state.items():
        agg_records.append({"mn":tuple(S["worldmn"]),"mx":tuple(S["worldmx"])})

    agginfo=v3.make_code_info(agg_records)
    aggcode=v3.union_codes([term(k) for k in aggkeys])
    v3.patch_mopp(data,mopps[316],agginfo,aggcode)

    agg_off=mopps[316]
    agg_old_size=v3.u32(original,agg_off+0x18)
    level_bounds_off=agg_off+0x1C+agg_old_size
    fullmn=[min(v[a] for v in verts)-4.0 for a in range(3)]
    fullmx=[max(v[a] for v in verts)+4.0 for a in range(3)]
    struct.pack_into(">6f",data,level_bounds_off,*(fullmn+fullmx))

    # ---------- VALIDATION ----------
    ffff=0
    for m in meshes:
        if m["ib"] is None:
            continue
        for i in range(m["ic"]):
            if struct.unpack_from(">H",data,m["ib"]+2*i)[0] == 0xFFFF:
                ffff += 1
    if ffff:
        raise RuntimeError("found %d FFFF render indices"%ffff)

    want=Counter(tuple(sorted(f[:3])) for f in faces)
    got=Counter()
    for src,S in state.items():
        m=S["mesh"]
        idx=[struct.unpack_from(">H",data,m["ib"]+2*i)[0] for i in range(m["ic"])]
        order=S["order"]
        for a,b,c in standard_strip_faces(idx):
            if a>=len(order) or b>=len(order) or c>=len(order):
                raise RuntimeError("decoded source %d index outside custom vertex table"%src)
            got[tuple(sorted((order[a],order[b],order[c])))] += 1

    exact=sum((want & got).values())
    extra=sum((got-want).values())
    missing=sum((want-got).values())
    if exact != len(faces) or extra or missing:
        raise RuntimeError(
            "render topology failed exact=%d/%d extra=%d missing=%d"%
            (exact,len(faces),extra,missing)
        )

    misses=[]
    candidate_counts=[]
    for src,S in state.items():
        ci,code=S["ci"],S["code"]
        org=S["origin"]
        for r in S["records"]:
            f=faces[r["fi"]]
            world=tuple(sum(verts[f[j]][a] for j in range(3))/3.0 for a in range(3))
            local=tuple(world[a]-org[a] for a in range(3))
            em,_=v3.eval_generated(code,ci,local,0.02)
            candidate_counts.append(len(em))
            if r["key"] not in em:
                misses.append((src,r["fi"],r["key"],local,em[:20]))
                if len(misses)>20:
                    break
    if misses:
        raise RuntimeError("source MOPP validation misses: %r"%misses[:5])

    # Decode packed N/T words we just wrote and verify orthogonality remains sane.
    packed_max_ndott=0.0
    packed_sign_counts=Counter()
    checked=0
    for S in state.values():
        m=S["mesh"]
        for li in range(len(S["order"])):
            o=m["vb"]+li*m["stride"]
            nw=struct.unpack_from(">I",data,o+0x0C)[0]
            tw=struct.unpack_from(">I",data,o+0x10)[0]
            n,_=decode_dec3n_word(nw)
            t,top=decode_dec3n_word(tw)
            packed_max_ndott=max(packed_max_ndott,abs(vdot(n,t)))
            packed_sign_counts[top]+=1
            checked+=1
    if packed_sign_counts[1]+packed_sign_counts[3] != checked:
        raise RuntimeError("unexpected packed tangent sign bits: %r"%dict(packed_sign_counts))

    Path(out_path).write_bytes(data)

    # v13: emit the exact index-buffer spans occupied by each OBJ material.
    # The GUI uses this to bind SR1 draw-range selectors after the proven v12
    # geometry/collision writer has finished.
    material_blocks=[]
    for src,S in sorted(state.items()):
        for st,si,p,k,L,base in S["blocks"]:
            material_blocks.append({
                "mesh": int(src),
                "material": str(st.get("mat", "")),
                "start_index": int(p),
                "index_length": int(L),
                "real_start": int(base),
                "triangle_count": int(len(st.get("faces_global", []))),
                "collision_segment": int(si),
            })
    if material_map_path:
        Path(material_map_path).write_text(json.dumps({
            "version": 13,
            "obj": str(obj_path),
            "bbchunk": str(out_path),
            "blocks": material_blocks,
        }, indent=2), encoding="utf-8")

    lines=[
        "Blood Gulch SR1 v13 - materials + recovered class-2 vertex attributes",
        "===========================================================",
        f"OBJ position records: {len(obj['positions_raw'])}",
        f"OBJ UV records: {len(obj['texcoords_raw'])}",
        f"OBJ normal records: {len(obj['normals_raw'])}",
        f"Expanded native corner vertices (v/vt/vn): {len(verts)}",
        f"OBJ triangles: {len(faces)}",
        f"Extra UV policy: {extra_uv_policy}",
        "",
        "Recovered vertex format written:",
        "  class 2 = float3 position + DEC3N normal + DEC3N tangent/sign + N*short2 UV",
        f"  native vertices written: {class2_written}",
        f"  UV values clamped to signed16: {uv_clamped}",
        f"  source OBJ normals used: {frame_stats['source_normals_used']}/{len(verts)}",
        f"  degenerate/missing UV faces for tangent build: {frame_stats['degenerate_uv_faces']}",
        f"  fallback tangents: {frame_stats['fallback_tangents']}",
        f"  tangent signs +1/-1: {frame_stats['sign_positive']}/{frame_stats['sign_negative']}",
        f"  max |N dot T| before packing: {frame_stats['max_abs_n_dot_t']:.8g}",
        f"  max |N dot T| after DEC3N packing: {packed_max_ndott:.8g}",
        f"  packed tangent top-bit counts: {dict(sorted(packed_sign_counts.items()))}",
        "",
        "Render topology validation:",
        f"  exact OBJ triangles: {exact}/{len(faces)}",
        f"  extra bridge triangles: {extra}",
        f"  missing triangles: {missing}",
        f"  FFFF render indices: {ffff}",
        "",
        "Collision validation:",
        f"  source collision triangles: {len(face_to_collision)}/{len(faces)}",
        f"  source MOPP centroid misses: {len(misses)}",
        f"  aggregate children emitted: {len(aggkeys)}",
        "",
        "Spatial chunks:"
    ]

    for iz in range(NZ):
        for ix in range(NX):
            src=tile_source[(ix,iz)]
            if src not in state:
                b0,obj50=SOURCES[src]
                lines.append(
                    "  tile (%d,%d) -> src %d / B0 %d: EMPTY "
                    "(render cleared; excluded from aggregate collision)"%
                    (ix,iz,src,b0)
                )
                continue
            S=state[src]
            m=S["mesh"]
            lines.append(
                "  tile (%d,%d) -> src %d / B0 %d: faces=%d strips=%d "
                "splitVerts=%d/%d stride=%d UVs=%d MOPP=%d/%d"%
                (
                    ix,iz,src,S["b0"],len(S["fids"]),len(S["strips"]),
                    len(S["order"]),m["vc"],m["stride"],S["uv_count"],
                    len(S["code"]),S["cap"]
                )
            )

    lines += [
        "",
        "What v13 specifically tests:",
        "  - no donor/template normal bytes on imported vertices",
        "  - no donor/template tangent bytes on imported vertices",
        "  - real OBJ UV0 encoded as signed 16-bit fixed point *1024",
        "  - UV seams/hard normals preserved by v/vt/vn vertex splitting",
        "  - recovered tangent handedness encoded in bits 30..31 (01=+1, 11=-1)",
        "",
        "Still not reversed:",
        "  - exact semantic/material role of UV1/UV2",
        "  - source material/texture assignment for imported Blood Gulch materials",
    ]
    Path(report_path).write_text("\n".join(lines),encoding="utf-8")
    print("\n".join(lines))


if __name__=="__main__":
    if len(sys.argv) not in (5,6,7):
        print("usage: python obj_to_sr1_bbchunk_spatial_chunks_v13_materials.py input.obj template.bbchunk_xbox2 output.bbchunk_xbox2 report.txt [copy|zero] [material_map.json]")
        raise SystemExit(2)
    policy=sys.argv[5] if len(sys.argv)>=6 else "copy"
    mmap=sys.argv[6] if len(sys.argv)>=7 else None
    main(sys.argv[1],sys.argv[2],sys.argv[3],sys.argv[4],policy,mmap)
