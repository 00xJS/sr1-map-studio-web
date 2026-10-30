"""Build and validate a complete map before replacing any installed map files."""
import functools
import inspect
import json
import os
import re
import shutil
import struct
import tempfile
from pathlib import Path

EXTENSIONS=('bbchunk_xbox2','peg_xbox2','bbcity_xbox2','hmap_xbox2','pvsv_xbox2','cts')

def validate_map(folder, name):
    import sr_reborn_core as core
    import peg_xbox2_beaver as peg
    import sr1_ledges
    folder=Path(folder)
    for ext in EXTENSIONS:
        if not (folder/f'{name}.{ext}').is_file():
            raise ValueError(f'Export is incomplete: missing {name}.{ext}')
    city=(folder/f'{name}.bbcity_xbox2').read_bytes()
    if len(city)==960: offset=0xbc
    elif len(city)==3060416: offset=0x400
    else: raise ValueError('Unsupported BBCity size in completed export.')
    if city[:8]!=bytes.fromhex('bbc17eee00000021'):
        raise ValueError('Invalid BBCity header.')
    city_name=city[offset:offset+16].split(b'\0')[0].decode('ascii')
    if city_name!=name:
        raise ValueError(f'Map filename is {name}, but BBCity loads {city_name}. Re-export using the intended map name; do not rename the files.')
    cts=(folder/f'{name}.cts').read_text(encoding='utf-8-sig')
    refs=re.findall(r'^\s*\+Chunk:\s*"([^"]+)"',cts,re.M)
    missing=[ref for ref in refs if not (folder/f'{ref}.bbchunk_xbox2').is_file()]
    if missing: raise ValueError('Spawn references missing chunk(s): '+', '.join(sorted(set(missing))))
    chunk=core.read_chunk((folder/f'{name}.bbchunk_xbox2').read_bytes())
    core.chunk_geometry(chunk)
    sr1_ledges.read(chunk)
    _,_,entries=peg.parse_peg(folder/f'{name}.peg_xbox2')
    if core.chunk_strings(chunk)!=[entry.name for entry in entries]:
        raise ValueError('BBChunk and PEG texture tables disagree. The export is incomplete or contains files from different builds.')
    if len(city)==3060416:
        environment=city[0x3ec:0x3fc].split(b'\0')[0].decode('ascii')
        if environment.startswith('sf_'):
            for ext in ('bbchunk_xbox2','peg_xbox2'):
                if not (folder/f'{environment}.{ext}').is_file():
                    raise ValueError('Surface registration resource is missing: '+environment+'.'+ext)
            core.read_chunk((folder/f'{environment}.bbchunk_xbox2').read_bytes())
            _,header,early=peg.parse_peg(folder/f'{environment}.peg_xbox2',include_frames=True)
            if len({e.name.lower() for e in early})!=header.count:
                raise ValueError('Surface registration directory count mismatch.')
            lookup={e.name:e for e in early}
            # Generated diffuse textures must be registered with exactly the
            # bytes used by the final map. Stock effect textures remain native.
            import sr1_physical_materials as physical
            prefixes=(name[:8].lower()+'_','ng_'+name[:7]+'_','ng_'+name+'_')
            for entry in entries:
                if entry.name.startswith(prefixes) and re.search(r'_('+'|'.join(physical.SUFFIXES)+r')\.tga$',entry.name):
                    preloaded=lookup.get(entry.name)
                    if preloaded is None or preloaded.raw[4:]!=entry.raw[4:] or preloaded.payload!=entry.payload:
                        raise ValueError('Surface texture is missing or differs from its early registration: '+entry.name)

def _publish(stage, output, backup, replace=os.replace):
    """Rollback handled errors during publication, including a locked destination."""
    files=sorted(p for p in stage.iterdir() if p.is_file())
    if any(p.is_dir() for p in stage.iterdir()):
        raise RuntimeError('Unexpected directory in completed export.')
    output.mkdir(parents=True,exist_ok=True)
    prior={}
    for p in files:
        target=output/p.name
        prior[p.name]=target.exists()
        if target.exists():shutil.copy2(target,backup/p.name)
    done=[]
    try:
        for p in files:
            replace(p,output/p.name);done.append(p.name)
    except Exception as error:
        failures=[]
        for name in reversed(done):
            try:
                if prior[name]:os.replace(backup/name,output/name)
                else:(output/name).unlink()
            except OSError as rollback_error:failures.append(f'{name}: {rollback_error}')
        if failures:
            # Retain recovery copies outside the temporary directory.
            recovery=Path(tempfile.mkdtemp(prefix='sr1_export_recovery_',dir=output.parent))
            shutil.copytree(backup,recovery,dirs_exist_ok=True)
            raise RuntimeError(f'Export installation failed and some files could not be restored. Recovery copies: {recovery}; '+ '; '.join(failures)) from error
        raise

def safe_export(build):
    signature=inspect.signature(build)
    @functools.wraps(build)
    def export(*args,**kwargs):
        bound=signature.bind(*args,**kwargs);bound.apply_defaults()
        output=Path(bound.arguments['output_dir']).resolve()
        output.parent.mkdir(parents=True,exist_ok=True)
        log=bound.arguments.get('log') or print
        with tempfile.TemporaryDirectory(prefix='.sr1_export_',dir=output.parent) as temp:
            stage=Path(temp)/'build';stage.mkdir()
            backup=Path(temp)/'backup';backup.mkdir()
            bound.arguments['output_dir']=stage
            def build_log(message):
                if str(message).startswith('Export complete'):return
                log(str(message).replace(str(stage),str(output)))
            bound.arguments['log']=build_log
            try:
                report=build(*bound.args,**bound.kwargs)
                validate_map(stage,report['map_name'])
                # Rewrite report paths before publication, including JSON diagnostics.
                def relocate(value):
                    if isinstance(value,str):return value.replace(str(stage),str(output))
                    if isinstance(value,Path):return Path(str(value).replace(str(stage),str(output)))
                    if isinstance(value,dict):return {k:relocate(v) for k,v in value.items()}
                    if isinstance(value,list):return [relocate(v) for v in value]
                    if isinstance(value,tuple):return tuple(relocate(v) for v in value)
                    return value
                report=relocate(report)
                for p in stage.glob('*.json'):
                    p.write_text(json.dumps(relocate(json.loads(p.read_text(encoding='utf-8'))),indent=2),encoding='utf-8')
                _publish(stage,output,backup)
            except Exception:
                log('Export failed. Incomplete build files were not kept in the output folder; any files replaced during installation were restored unless a recovery error is shown.')
                raise
        log('Export complete — validated map files saved to: '+str(output))
        return report
    return export
