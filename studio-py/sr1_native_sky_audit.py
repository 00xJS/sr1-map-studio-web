"""Read-only diagnostics for full BBCity environment identifiers."""
from pathlib import Path
import hashlib

MAGIC=bytes.fromhex('bbc17eee00000021')
SIZE=3060416

def inspect_bbcity(path):
    p=Path(path)
    with p.open('rb') as f:
        data=f.read()
    result={'name':p.name,'size':len(data),'sha256':hashlib.sha256(data).hexdigest(),
            'format':'full-retail' if len(data)==SIZE else 'compact' if len(data)==960 else 'unknown',
            'valid_header':data[:8]==MAGIC, 'environment_reference':None,'map_identifier':None}
    if result['format']=='full-retail' and result['valid_header']:
        # These offsets were confirmed by bytewise comparison of Downtown, Factory, Seafood.
        result['environment_reference']=data[0x3ec:0x3fc].split(b'\0')[0].decode('ascii','replace')
        result['map_identifier']=data[0x400:0x410].split(b'\0')[0].decode('ascii','replace')
    return result

def audit_pair(chunk,peg):
    out={}
    for kind,path,signature in (('chunk',chunk,bytes.fromhex('bbcaca12')),
                                 ('peg',peg,bytes.fromhex('564b4547'))):
        p=Path(path)
        with p.open('rb') as f: head=f.read(16)
        out[kind]={'name':p.name,'size':p.stat().st_size,'valid_header':head.startswith(signature)}
    return out
