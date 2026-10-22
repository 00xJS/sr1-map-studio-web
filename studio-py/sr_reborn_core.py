#!/usr/bin/env python3
"""Saints Reborn map-format core, ported to Python from the GPL-3.0-or-later
Saints Reborn Map Converter source supplied by the user.

This module intentionally keeps the source project's structure/names where practical:
- big-endian helpers
- .bbchunk_xbox2 section parser/writer
- editable geometry/material structures
- Havok MOPP collision builder
- .vpp_xbox2 reader
- PEG append/rename helpers

The port is used by SR1 Halo Map Studio without Blender.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from pathlib import Path
import math, struct, zlib
from typing import List, Dict, Tuple, Optional


def Al(c:int,a:int)->int: return (c+a-1)//a*a

def U32(b,o):
    if o+4>len(b): raise RuntimeError('read past end of data')
    return int.from_bytes(b[o:o+4],'big',signed=False)
def U16(b,o):
    if o+2>len(b): raise RuntimeError('read past end of data')
    return int.from_bytes(b[o:o+2],'big',signed=False)
def I32(b,o):
    v=U32(b,o); return v-(1<<32) if v&0x80000000 else v
def S16(b,o):
    v=U16(b,o); return v-(1<<16) if v&0x8000 else v
def F32(b,o): return struct.unpack_from('>f',b,o)[0]
def Wr32(b,o,v): struct.pack_into('>I',b,o,int(v)&0xffffffff)
def Wr16(b,o,v): struct.pack_into('>H',b,o,int(v)&0xffff)
def WrF(b,o,v): struct.pack_into('>f',b,o,float(v))
def Put32(b,v): b += int(v&0xffffffff).to_bytes(4,'big')
def Put16(b,v): b += int(v&0xffff).to_bytes(2,'big')
def PutF(b,v): b += struct.pack('>f',float(v))
def Slice(b,a,z):
    if a>z or z>len(b): raise RuntimeError('slice past end of data')
    return bytearray(b[a:z])
def PadTo(b,a,base=0):
    pos=base+len(b); b += b'\0'*(Al(pos,a)-pos)


# ------------------------- VPP packfiles -------------------------
@dataclass
class VppEntry:
    name:str; at:int; size:int; stored:int

class Packfile:
    def __init__(self,path):
        self.path=Path(path); self.f=self.path.open('rb')
        h=self.f.read(0x800)
        if len(h)!=0x800 or U32(h,0)!=0x51890ACE or U32(h,4)!=3:
            raise RuntimeError(f'{self.path} is not a Saints Row packfile')
        flags,count,dir_size,names_size=U32(h,0x14C),U32(h,0x154),U32(h,0x15C),U32(h,0x160)
        if flags&2: raise RuntimeError(f'{self.path}: condensed packfiles are not supported')
        self.compressed=bool(flags&1)
        directory=self.f.read(dir_size)
        names_at=Al(0x800+dir_size,2048)
        self.f.seek(names_at); names=self.f.read(names_size)
        if len(directory)!=dir_size or len(names)!=names_size: raise RuntimeError(f'{self.path}: truncated directory')
        data_at=Al(names_at+names_size,2048); cur=data_at
        self.entries=[]
        for i in range(count):
            no=U32(directory,28*i); off=U32(directory,28*i+8)
            size=U32(directory,28*i+16); stored=U32(directory,28*i+20)
            end=names.find(b'\0',no)
            if end<0: end=len(names)
            name=names[no:end].decode('utf-8','replace')
            if self.compressed:
                at=cur; cur=Al(cur+stored,2048)
            else: at=data_at+off
            self.entries.append(VppEntry(name,at,size,stored))
    def find(self,name):
        l=name.lower()
        return next((e for e in self.entries if e.name.lower()==l),None)
    def has(self,name): return self.find(name) is not None
    def read(self,name):
        e=self.find(name)
        if not e: raise RuntimeError(f'{name} is not in {self.path.name}')
        self.f.seek(e.at); raw=self.f.read(e.stored if self.compressed else e.size)
        if len(raw)!=(e.stored if self.compressed else e.size): raise RuntimeError('cannot read '+name)
        if not self.compressed: return bytearray(raw)
        if len(raw)<2: raise RuntimeError('cannot decompress '+name)
        # C++ source uses puff on raw deflate after the 2-byte zlib header and accepts
        # truncated-final-marker streams if the expected output size was produced.
        dec=zlib.decompressobj(-15)
        out=dec.decompress(raw[2:],e.size)+dec.flush()
        if len(out)!=e.size: raise RuntimeError(f'cannot decompress {name}: {len(out)} != {e.size}')
        return bytearray(out)
    def close(self):
        try:self.f.close()
        except:pass


# ------------------------- geometry structures -------------------------
@dataclass
class VertexBuffer:
    desc:bytearray=field(default_factory=bytearray); has_aux:bool=False
    aux_header:bytearray=field(default_factory=bytearray); aux_a:bytearray=field(default_factory=bytearray); aux_b:bytearray=field(default_factory=bytearray)
    ib:bytearray=field(default_factory=bytearray); vd:bytearray=field(default_factory=bytearray)
@dataclass
class SubMesh:
    s16:bytearray=field(default_factory=bytearray); b16:bytearray=field(default_factory=bytearray)
    has12:bool=False; s12:bytearray=field(default_factory=bytearray); b12:bytearray=field(default_factory=bytearray)
@dataclass
class Mesh:
    has48:bool=False; blk48:bytearray=field(default_factory=bytearray); hdr:bytearray=field(default_factory=bytearray); subs:List[SubMesh]=field(default_factory=list)
@dataclass
class Material:
    m:bytearray=field(default_factory=bytearray); parts:List[bytearray]=field(default_factory=list)
@dataclass
class MaterialEntry:
    e:bytearray=field(default_factory=bytearray); x:bytearray=field(default_factory=bytearray)
@dataclass
class Geometry:
    coll:bytearray=field(default_factory=bytearray); vec24:bytearray=field(default_factory=bytearray); vbptr:bytearray=field(default_factory=bytearray)
    auxflag:List[int]=field(default_factory=list); vbs:List[VertexBuffer]=field(default_factory=list); mathdr:bytearray=field(default_factory=bytearray)
    mats:List[Material]=field(default_factory=list); ents:List[MaterialEntry]=field(default_factory=list); meshes:List[Mesh]=field(default_factory=list)
    start:int=0; end:int=0


def read_geometry(d,at,nv,nmesh,a164_at):
    g=Geometry(); c=at
    n=U32(d,c); g.coll=Slice(d,c+4,c+4+n); c+=4+n
    g.vec24=Slice(d,c,c+24); c+=24; c=Al(c,4)
    g.vbptr=Slice(d,c,c+4*nv); c+=4*nv
    g.auxflag=[U32(d,c+4*i) for i in range(nv)]; c+=4*nv; c=Al(c,64)
    g.vbs=[VertexBuffer() for _ in range(nv)]
    for i,V in enumerate(g.vbs):
        c=Al(c,16); V.desc=Slice(d,c,c+88); c+=88
        if g.auxflag[i]:
            V.has_aux=True; c=Al(c,16); V.aux_header=Slice(d,c,c+16); c+=16
            if U32(V.aux_header,0): c=Al(c,32); k=U16(V.aux_header,8)*2; V.aux_a=Slice(d,c,c+k); c+=k
            if U32(V.aux_header,4): c=Al(c,32); k=U16(V.aux_header,10)*2; V.aux_b=Slice(d,c,c+k); c+=k
    c=Al(c,4096)
    for V in g.vbs:
        if U32(V.desc,8): c=Al(c,32); k=U16(V.desc,14)*2; V.ib=Slice(d,c,c+k); c+=k
        if U32(V.desc,4): c=Al(c,32); k=U16(V.desc,16)*U16(V.desc,12); V.vd=Slice(d,c,c+k); c+=k
    c=Al(c,4096); c=Al(c,16); g.mathdr=Slice(d,c,c+12); c+=12
    nm,n2=U16(g.mathdr,0),U16(g.mathdr,2)
    if nm:
        c=Al(c,16); mb=c; c+=nm*56; c=Al(c,16)
        for i in range(nm):
            M=Material(Slice(d,mb+56*i,mb+56*i+56),[])
            def take(a,k):
                nonlocal c; c=Al(c,a); q=Slice(d,c,c+k); c+=k; return q
            M.parts.append(take(4,U16(M.m,10)*12))
            M.parts.append(take(4,max(S16(M.m,20),0)*8))
            for off in (28,40):
                M.parts.append(take(16,U16(M.m,off)*24)); M.parts.append(take(16,U16(M.m,off+2)*2))
            M.parts.append(take(4,U16(M.m,8)*6)); g.mats.append(M)
    if n2:
        c=Al(c,4); eb=c; c+=n2*16
        for i in range(n2):
            E=MaterialEntry(Slice(d,eb+16*i,eb+16*i+16),bytearray()); c=Al(c,4); k=U16(E.e,8)*4; E.x=Slice(d,c,c+k); c+=k; g.ents.append(E)
    for i in range(nmesh):
        M=Mesh(); e=a164_at+16*i
        if U32(d,e+4):
            m=c; k=48+U32(d,m+36)*12+U32(d,m+28)*4+U32(d,m+44)*2
            M.has48=True; M.blk48=Slice(d,c,c+k); c+=k
        c=Al(c,4); M.hdr=Slice(d,c,c+40); c+=40; c=Al(c,16); c=Al(c,16)
        k=S16(M.hdr,28)
        if k<0: raise RuntimeError('bad submesh count')
        s32=c; c+=16*k; has36=U32(M.hdr,36)!=0; s36=0
        if has36: c=Al(c,16); s36=c; c+=12*k
        for j in range(k):
            S=SubMesh(); S.s16=Slice(d,s32+16*j,s32+16*j+16)
            if U16(S.s16,2): c=Al(c,16); n8=U16(S.s16,2)*8; S.b16=Slice(d,c,c+n8); c+=n8
            if has36:
                S.has12=True; S.s12=Slice(d,s36+12*j,s36+12*j+12)
                if U16(S.s12,2): c=Al(c,16); n8=U16(S.s12,2)*8; S.b12=Slice(d,c,c+n8); c+=n8
            M.subs.append(S)
        g.meshes.append(M)
    g.start,g.end=at,c; return g


def write_geometry(g,start):
    out=bytearray()
    def A(n): PadTo(out,n,start)
    Put32(out,len(g.coll)); out+=g.coll; out+=g.vec24; A(4); out+=g.vbptr
    for x in g.auxflag: Put32(out,x)
    A(64)
    for i,V in enumerate(g.vbs):
        A(16); out+=V.desc
        if g.auxflag[i]:
            A(16); out+=V.aux_header
            if U32(V.aux_header,0): A(32); out+=V.aux_a
            if U32(V.aux_header,4): A(32); out+=V.aux_b
    A(4096)
    for V in g.vbs:
        if U32(V.desc,8): A(32); out+=V.ib
        if U32(V.desc,4): A(32); out+=V.vd
    A(4096); A(16); out+=g.mathdr
    if g.mats:
        A(16)
        for M in g.mats: out+=M.m
        A(16)
        for M in g.mats:
            P=M.parts
            for ai,idx in ((4,0),(4,1),(16,2),(16,3),(16,4),(16,5),(4,6)):
                A(ai); out+=P[idx]
    if g.ents:
        A(4)
        for E in g.ents: out+=E.e
        for E in g.ents: A(4); out+=E.x
    for M in g.meshes:
        if M.has48: out+=M.blk48
        A(4); out+=M.hdr; A(16); A(16)
        for S in M.subs: out+=S.s16
        if U32(M.hdr,36):
            A(16)
            for S in M.subs: out+=S.s12
        for S in M.subs:
            if U16(S.s16,2): A(16); out+=S.b16
            if U32(M.hdr,36) and U16(S.s12,2): A(16); out+=S.b12
    return out


# ------------------------- chunk container -------------------------
@dataclass
class Section:
    name:str; align:int; data:bytearray
@dataclass
class ChunkCounts:
    meshes:int=0; instances:int=0; vbs:int=0; c180:int=0
@dataclass
class Chunk:
    header:bytearray; secs:List[Section]
    def get(self,name):
        for s in self.secs:
            if s.name==name:return s
        raise RuntimeError('chunk has no section '+name)
    def offset_of(self,name):
        c=len(self.header)
        for s in self.secs:
            c=Al(c,s.align)
            if s.name==name:return c
            c+=len(s.data)
        raise RuntimeError('chunk has no section '+name)

def _parse_front(d):
    if len(d)<968 or U32(d,0)!=0xBBCACA12: raise RuntimeError('not a Saints Row map chunk (.bbchunk_xbox2)')
    if U32(d,4)!=85: raise RuntimeError('unsupported chunk version')
    c=Al(968,64); strings_at=c; n=U32(d,c); c+=4+4*n
    for _ in range(n):
        z=d.find(0,c)
        if z<0: raise RuntimeError('bad string table')
        c=z+1
    strings_end=c; c=Al(c,64); counts_at=c
    cc=ChunkCounts(U32(d,c),U32(d,c+4),U32(d,c+8),U32(d,c+12)); c+=16; c=Al(c,64)
    a164_at=c; c+=16*cc.meshes; c=Al(c,64); inst_at=c; c+=112*cc.instances; c=Al(c,64); a184_at=c; c+=100*cc.c180
    c=Al(c,64); c=Al(c,64); blob_size=U32(d,c); c+=4; blob_at=c; c+=blob_size; c=Al(c,64); geo_at=c
    return dict(strings_at=strings_at,strings_end=strings_end,counts_at=counts_at,a164_at=a164_at,inst_at=inst_at,a184_at=a184_at,blob_at=blob_at,blob_size=blob_size,geo_at=geo_at,n=cc)

def _cstr_end(d,at):
    z=d.find(0,at)
    if z<0: raise RuntimeError('unterminated string')
    return z+1

def _tree_end(d,at):
    n=U32(d,at); c2=Al(at+4,64); b=c2; c2+=44*n; sm=sum(U32(d,b+44*i+12) for i in range(n)); c2+=sm*2; return c2,n

def _kdtree_end(d,node,c2,esz):
    while I32(d,node)>=0:
        cnt=I32(d,node); data=c2
        if cnt==0:
            c2+=64; c2=_kdtree_end(d,data,c2,esz); node=data+32; continue
        c2+=cnt*esz; c2=Al(c2,4); break
    return c2

def _walk_tail(d,geo_end):
    c=geo_end; marks=[]
    def mark(n,s): marks.append((n,(s,c)))
    H=lambda o:U32(d,o)
    c=Al(c,64); c=Al(c,64)
    n=H(868); s=c; c+=80*n
    for _ in range(n): c=_cstr_end(d,c)
    mark('static_records',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4+sz; mark('rec_blob308',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+4*n; mark('u32_list524',s)
    for key in (540,548):
        c=Al(c,64); s=c; n=U32(d,c); c+=4; b=c; c+=80*n
        for i in range(n): c+=U32(d,b+80*i+72)*4
        mark('rec80_'+str(key),s)
    c=Al(c,64); s=c; n=I32(d,900); c+=84*max(n,0); mark('spawns900',s)
    c=Al(c,64); s=c; c+=48*H(872); mark('rec48_204',s)
    c=Al(c,64); s=c; c=_tree_end(d,c)[0]; mark('tree236',s)
    c=Al(c,64); s=c; c+=2*H(936); mark('u16_936',s)
    c=Al(c,64); s=c; c+=H(864); mark('skip864',s)
    c=Al(c,64); s=c; c+=28*H(908)+24*H(912)+28*H(916)+4*H(920)+12*H(924)+8*H(928)+H(932); mark('nav908',s)
    c=Al(c,64); s=c
    if H(896)>0: raise RuntimeError('template chunk has unsupported section (header 896)')
    mark('mesh896',s)
    c=Al(c,64); s=c; n=H(884); b=c; c+=136*n
    for _ in range(n): c=_cstr_end(d,c)
    c=Al(c,64)
    for i in range(n):
        v=I32(d,b+136*i+20)
        if v>0:c+=4*v
    c=Al(c,64)
    for i in range(n):
        v=I32(d,b+136*i+28)
        if v:c+=2*abs(v)
    mark('rec136_260',s)
    c=Al(c,4096); s=c; c=_tree_end(d,c)[0]; mark('tree192',s)
    c=Al(c,64); s=c; c+=2*H(888); mark('u16_196',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4+sz; mark('blob_a',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4+sz; mark('rec40_324',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+80*n; mark('rec80_268',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+200*n; c=_tree_end(d,c)[0]; mark('rec200_52+tree60',s)
    c=Al(c,64); s=c; sz=U32(d,c+8); c+=sz; mark('block556',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+52*n; mark('rec52_424',s)
    c=Al(c,64); s=c
    for _ in range(2): sz=U32(d,c); c+=4+sz
    mark('blobs76_84',s)
    c=Al(c,64); s=c
    for _ in range(2): sz=U32(d,c); c+=4+sz
    mark('blobs92_100',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+100*n; mark('rec100_104',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4+sz; mark('blob_82515210',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+32*n; mark('rec32_348',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4
    if n>0:
        esz=U32(d,c); root=c+12; c+=44; c=_kdtree_end(d,root,c,esz)
    mark('kdtree356',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4; b=c; c+=40*n
    for i in range(n): c+=U32(d,b+40*i)*12+U32(d,b+40*i+8)*12
    mark('rec40_360',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4+sz; mark('blob_822500D8',s)
    c=Al(c,64); s=c; sz=U32(d,c); c+=4; n372=U32(d,c); c+=sz; mark('list372',s)
    c=Al(c,64); s=c; c+=4; c+=H(204)-4; mark('skip388',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+76*n; mark('rec76_396',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4
    if n>0: c+=96*n; sz=U32(d,c); c+=4+sz
    mark('movers404',s)
    for k in (440,444,448): c=Al(c,64); s=c; sz=U32(d,c+8); c+=sz; mark('block'+str(k),s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+60*n; mark('rec60_416',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4
    for _ in range(n):
        c=Al(c,4); h=c; c+=40; c=Al(c,16); c+=U16(d,h+24)*16+U16(d,h+32)*6
    mark('rec40_380',s)
    c=Al(c,64); s=c
    for _ in range(n372): c=Al(c,4); sz=U32(d,c); c+=4+sz
    mark('blobs384',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4
    if n>0:
        c+=36*n; m=U32(d,c); c+=4+36*m; sz=U32(d,c); c+=4+sz
    mark('rec36_432',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+52*n; sz=U32(d,c); c+=4+sz; mark('rec52_452',s)
    c=Al(c,64); s=c; n1=U32(d,c); c+=4+4*n1; n2=U32(d,c); c+=4+88*n2; n3=U32(d,c); c+=4+3*n3; sz=U32(d,c); c+=4+sz; mark('rec_460_468_476',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4
    if n:
        c+=88*n
        for _ in range(n): c=Al(c,4); a=U32(d,c); b2=U32(d,c+4); c+=16+a*16+b2*6
    mark('rec88_484',s)
    c=Al(c,64); s=c; n=I32(d,c)
    if n>32767 or n<0: n=int.from_bytes(d[c:c+4],'little',signed=True)
    c+=4+44*n; mark('rec44_492',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+8*n; mark('rec8_504',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+72*n; mark('rec72_512',s)
    c=Al(c,64); s=c; n=U32(d,c); c+=4+4*n; mark('u32_532',s)
    for _ in range(32): c=Al(c,64); c+=4
    c=Al(c,2048)
    return marks,c

DIR_RULES=[
(0x50,'blob_a','blob_a',1),(0x58,'rec40_324','rec40_324',1),(0x60,'rec80_268','rec80_268',0),(0x70,'@968','mesh896',2),
(0x78,'rec200_52+tree60','rec200_52+tree60',0),(0x80,'rec136_260','u16_196',0),(0x88,'blobs76_84','blobs76_84',0),(0x90,'blobs92_100','blobs92_100',0),
(0x98,'rec100_104','rec100_104',0),(0xa0,'blob_82515210','blob_82515210',0),(0xa8,'rec32_348','rec32_348',0),(0xb0,'kdtree356','kdtree356',0),
(0xb8,'rec40_360','blob_822500D8',0),(0xc0,'list372','list372',0),(0xc8,'skip388','skip388',0),(0xd0,'rec76_396','rec76_396',1),
(0xd8,'movers404','movers404',1),(0xe0,'block440','block440',0),(0xe8,'block444','block448',0),(0xf0,'rec60_416','rec60_416',0),
(0xf8,'rec40_380','rec40_380',0),(0x100,'blobs384','blobs384',0),(0x108,'rec36_432','rec36_432',0),(0x110,'rec52_452','rec52_452',1),
(0x118,'rec_460_468_476','rec_460_468_476',1),(0x120,'rec88_484','rec88_484',1),(0x128,'rec44_492','rec44_492',1),(0x130,'rec8_504','rec8_504',1),
(0x138,'rec72_512','rec72_512',0),(0x140,'u32_532','u32_532',0)]

def read_chunk(d):
    d=bytearray(d); f=_parse_front(d); g=read_geometry(d,f['geo_at'],f['n'].vbs,f['n'].meshes,f['a164_at']); marks,end=_walk_tail(d,g.end)
    if end!=len(d): raise RuntimeError(f'chunk layout not understood (size mismatch {end} != {len(d)})')
    secs=[Section('strings',64,Slice(d,f['strings_at'],f['strings_end'])),Section('counts',64,Slice(d,f['counts_at'],f['counts_at']+16)),
          Section('a164',64,Slice(d,f['a164_at'],f['a164_at']+16*f['n'].meshes)),Section('instances',64,Slice(d,f['inst_at'],f['inst_at']+112*f['n'].instances)),
          Section('a184',64,Slice(d,f['a184_at'],f['a184_at']+100*f['n'].c180)),Section('blob64',64,Slice(d,f['blob_at']-4,f['blob_at']+f['blob_size'])),
          Section('geometry',64,Slice(d,f['geo_at'],marks[0][1][0]))]
    for name,(a,z) in marks: secs.append(Section(name,4096 if name=='tree192' else 64,Slice(d,a,z)))
    return Chunk(Slice(d,0,968),secs)

def write_chunk(ch):
    out=bytearray(ch.header); pos={}; order=[]
    for s in ch.secs:
        PadTo(out,s.align); a=len(out); out+=s.data; pos[s.name]=(a,len(out)); order.append(s.name)
    for _ in range(32): PadTo(out,64); out+=b'\0'*4
    PadTo(out,2048)
    for off,first,last,rule in DIR_RULES:
        if first=='@968':
            idx=order.index(last); start=968; end=pos[order[idx+1]][0]
        else:
            start=pos[first][0]; end=pos[last][1]
            if rule==1:end=Al(end,64)
        Wr32(out,off,start); Wr32(out,off+4,end-start)
    b0=pos['blobs76_84'][0]; s0=U32(out,b0); b1=b0+4+s0; s1=U32(out,b1)
    Wr32(out,848,b0); Wr32(out,852,s0); Wr32(out,856,b1); Wr32(out,860,s1)
    return out

def counts(ch):
    c=ch.get('counts').data; return ChunkCounts(U32(c,0),U32(c,4),U32(c,8),U32(c,12))
def chunk_geometry(ch):
    d=write_chunk(ch); n=counts(ch); return read_geometry(d,ch.offset_of('geometry'),n.vbs,n.meshes,ch.offset_of('a164'))
def set_geometry(ch,g): ch.get('geometry').data=write_geometry(g,ch.offset_of('geometry'))
def chunk_strings(ch):
    b=ch.get('strings').data; n=U32(b,0); c=4+4*n; out=[]
    for _ in range(n): z=b.find(0,c); out.append(bytes(b[c:z]).decode('ascii','replace')); c=z+1
    return out
def add_strings(ch,names):
    b=ch.get('strings').data; n=U32(b,0); out=bytearray(); Put32(out,n+len(names)); out+=b[4:4+4*n]; out+=b'\0'*(4*len(names)); out+=b[4+4*n:]
    idx=[]
    for i,name in enumerate(names): out+=name.encode('ascii')+b'\0'; idx.append(n+i)
    ch.get('strings').data=out; return idx


# ------------------------- collision MOPP -------------------------
def mesh_triangles(g,k):
    out=[]
    for S in g.meshes[k].subs:
        V=g.vbs[U32(S.s16,8)]; st=U16(V.desc,16)
        for b in range(U16(S.s16,2)):
            first=U32(S.b16,8*b); cnt=U16(S.b16,8*b+4)
            for p in range(cnt-2):
                t=[U16(V.ib,2*(first+p+j)) for j in range(3)]
                if len(set(t))<3: continue
                pts=[[F32(V.vd,st*idx+4*a) for a in range(3)] for idx in t]
                out.append(((b<<16)|(first+p),pts))
    return out

def _term(k):
    if k<32:return bytes([0x30+k])
    if k<256:return bytes([0x50,k])
    if k<65536:return bytes([0x51,k>>8,k&255])
    if k<1<<24:return bytes([0x52,(k>>16)&255,(k>>8)&255,k&255])
    if k<1<<32:return bytes([0x53,(k>>24)&255,(k>>16)&255,(k>>8)&255,k&255])
    raise RuntimeError('collision triangle key exceeds 32-bit MOPP range')

def _node(L,lo,hi):
    if hi-lo==1:return _term(L[lo]['key'])
    ext=[]
    for a in range(3):
        mx=max(L[i]['mx'][a] for i in range(lo,hi)); mn=min(L[i]['mn'][a] for i in range(lo,hi)); ext.append(mx-mn)
    ax=max(range(3),key=lambda a:ext[a]); L[lo:hi]=sorted(L[lo:hi],key=lambda q:(q['mn'][ax]+q['mx'][ax],q['key']))
    h=lo+(hi-lo)//2; A=max(L[i]['mx'][ax] for i in range(lo,h)); B=min(L[i]['mn'][ax] for i in range(h,hi))
    lc=_node(L,lo,h); rc=_node(L,h,hi)
    if len(lc)<=255: head=bytes([0x10+ax,A,B,len(lc)])
    else:
        if len(lc)>65535:raise RuntimeError('collision tree too large')
        head=bytes([0x23+ax,A,B,0,0,(len(lc)>>8)&255,len(lc)&255])
    return head+lc+rc

def build_mopp_block(items):
    if not items: raise RuntimeError('empty collision block')
    mn=[]; mx=[]
    for a in range(3):
        mn.append(min(x['mn'][a] for x in items)-.05); mx.append(max(x['mx'][a] for x in items)+.05)
    ext=max(mx[a]-mn[a] for a in range(3)); scale=(1<<24)/ext*.999
    L=[]
    for it in items:
        q={'key':it['key'],'mn':[],'mx':[]}
        for a in range(3):
            lo=int((it['mn'][a]-mn[a])*scale)>>16; hi=(int((it['mx'][a]-mn[a])*scale)>>16)+1
            q['mn'].append(max(0,min(255,lo))); q['mx'].append(max(0,min(255,hi)))
        L.append(q)
    code=_node(L,0,len(L)); out=bytearray(b'PPOM'); Put32(out,300); [PutF(out,x) for x in mn]; PutF(out,scale); Put32(out,len(code)); out+=code; return out

def parse_mopp_blocks(d):
    B=[]; c=0
    while c<len(d):
        if c+28>len(d) or bytes(d[c:c+4])!=b'PPOM':raise RuntimeError('collision blob not understood')
        n=U32(d,c+24); B.append({'at':c,'header24':Slice(d,c,c+24),'code':Slice(d,c+28,c+28+n)}); c=Al(c+28+n,64)
    return B

def mopp_keys(code):
    out=[]
    def run(i,off,depth):
        if depth>400:raise RuntimeError('collision code too deep')
        while True:
            if i>=len(code):raise RuntimeError('collision code runs past its end')
            op=code[i]
            if 0x30<=op<=0x4f:out.append(off+op-0x30);return
            if op==0x50:out.append(off+code[i+1]);return
            if op==0x51:out.append(off+((code[i+1]<<8)|code[i+2]));return
            if op==0x52:out.append(off+((code[i+1]<<16)|(code[i+2]<<8)|code[i+3]));return
            if op==0x53:out.append(off+int.from_bytes(code[i+1:i+5],'big'));return
            if op==0x05:i+=2+code[i+1];continue
            if op==0x06:i+=3+((code[i+1]<<8)|code[i+2]);continue
            if op==0x09:off+=code[i+1];i+=2;continue
            if op==0x0A:off+=(code[i+1]<<8)|code[i+2];i+=3;continue
            if op==0x0B:off=int.from_bytes(code[i+1:i+5],'big');i+=5;continue
            if 0x01<=op<=0x04:i+=4;continue
            if 0x20<=op<=0x22 or 0x26<=op<=0x28:i+=3;continue
            if 0x29<=op<=0x2b:i+=7;continue
            if 0x10<=op<=0x1c:run(i+4,off,depth+1);i=i+4+code[i+3];continue
            if 0x23<=op<=0x25:
                j1=(code[i+3]<<8)|code[i+4]; j2=(code[i+5]<<8)|code[i+6]; run(i+7+j1,off,depth+1); i=i+7+j2; continue
            raise RuntimeError(f'unexpected collision opcode 0x{op:02X}')
    if code:run(0,0,0)
    return out

def instance_aabb(inst,i,bmin,bmax):
    ia=112*i; pos=[F32(inst,ia+4+4*k) for k in range(3)]; R=[F32(inst,ia+16+4*k) for k in range(9)]
    mn=[1e30]*3; mx=[-1e30]*3
    for c in range(8):
        v=[bmax[0] if c&1 else bmin[0],bmax[1] if c&2 else bmin[1],bmax[2] if c&4 else bmin[2]]
        for j in range(3):
            w=pos[j]+sum(v[k]*R[3*k+j] for k in range(3)); mn[j]=min(mn[j],w); mx[j]=max(mx[j],w)
    return mn,mx

def rebuild_collision(g,inst,has_coll):
    stock=parse_mopp_blocks(g.coll)
    if len(stock)!=len(g.meshes)+1:raise RuntimeError(f'collision block count {len(stock)} does not match meshes {len(g.meshes)}')
    B=[]
    for k in range(len(g.meshes)):
        if not has_coll[k]:
            b=bytearray(stock[k]['header24']); b+=b'\0'*4; B.append(b); continue
        items=[]
        for key,pts in mesh_triangles(g,k):
            items.append({'key':key,'mn':[min(p[a] for p in pts) for a in range(3)],'mx':[max(p[a] for p in pts) for a in range(3)]})
        B.append(build_mopp_block(items))
    vbk=[-1 if not M.subs else U32(M.subs[0].s16,8) for M in g.meshes]; items=[]
    for i in range(len(inst)//112):
        flags=U32(inst,112*i+108); me=U32(inst,112*i+104)
        if me>=len(g.meshes):continue
        try: canon=vbk.index(vbk[me])
        except ValueError: continue
        if (flags&0x4c7) or not has_coll[canon]:continue
        h=g.meshes[me].hdr; bmin=[F32(h,0),F32(h,4),F32(h,8)]; bmax=[F32(h,12),F32(h,16),F32(h,20)]; mn,mx=instance_aabb(inst,i,bmin,bmax)
        items.append({'key':len(items),'mn':mn,'mx':mx})
    if not items:raise RuntimeError('nothing to collide with')
    B.append(build_mopp_block(items)); blob=bytearray()
    for i,b in enumerate(B): blob+=b; PadTo(blob,64) if i+1<len(B) else None
    g.coll=blob; return len(items)


def crc32_sr(s):
    c=0xffffffff
    for ch in s.encode('utf-8'):
        c^=ch
        for _ in range(8): c=(c>>1)^(0xEDB88320 & (0-(c&1)))
    return (~c)&0xffffffff

# Attribution marker used by Map Studio diagnostics.
PORT_SOURCE='Saints Reborn Map Converter source (GPL-3.0-or-later), Python port'
