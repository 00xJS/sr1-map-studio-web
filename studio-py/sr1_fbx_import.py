"""Convert Autodesk FBX to Wavefront OBJ + MTL through Blender for SR1 Map Studio.
Blender is an optional dependency; no unsupported in-house FBX parser is used.
"""
from pathlib import Path
import hashlib
import os
import shutil
import subprocess

BLENDER_SCRIPT = r'''import bpy
import sys
from pathlib import Path
argv = sys.argv[sys.argv.index("--")+1:]
source, target = argv
bpy.ops.wm.read_factory_settings(use_empty=True)
if hasattr(bpy.ops.wm, "fbx_import"):
    bpy.ops.wm.fbx_import(filepath=source)
else:
    bpy.ops.import_scene.fbx(filepath=source)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise RuntimeError("FBX contains no mesh objects")
for o in bpy.context.selected_objects: o.select_set(False)
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
# Both exporters write OBJ + MTL. Leave textures in the original FBX folder
# or copy files that are referenced by generated MTL paths.
if hasattr(bpy.ops.wm, "obj_export"):
    bpy.ops.wm.obj_export(filepath=target, export_selected_objects=True,
        export_materials=True, export_uv=True, export_normals=True,
        path_mode="COPY", apply_modifiers=True)
else:
    bpy.ops.export_scene.obj(filepath=target, use_selection=True,
        use_materials=True, use_uvs=True, use_normals=True,
        path_mode="COPY", use_mesh_modifiers=True, axis_forward="-Z", axis_up="Y")
print("SR1_FBX_EXPORT_OK", len(meshes))
'''

def locate_blender(explicit=None):
    candidates = [explicit, os.environ.get('SR1_BLENDER_PATH'), shutil.which('blender')]
    if os.name == 'nt':
        program_files=os.environ.get('PROGRAMFILES','C:/Program Files')
        base=Path(program_files)/'Blender Foundation'
        if base.exists():
            candidates += [str(x) for x in sorted(base.glob('Blender */blender.exe'),reverse=True)]
    for candidate in candidates:
        if candidate and Path(candidate).is_file(): return str(Path(candidate).resolve())
    raise FileNotFoundError('Blender was not found. Install Blender 3.x/4.x/5.x and set SR1_BLENDER_PATH to blender.exe (or put Blender on PATH).')

def convert_fbx(source, blender_path=None, cache_root=None):
    source=Path(source).resolve()
    if not source.is_file() or source.suffix.lower()!='.fbx':
        raise ValueError('Choose an existing .fbx file')
    cache_root=Path(cache_root) if cache_root else Path(__file__).resolve().parent/'fbx_cache'
    cache_root.mkdir(parents=True,exist_ok=True)
    token=hashlib.sha256(str(source).encode('utf8')).hexdigest()[:12]
    folder=cache_root/(source.stem+'_'+token)
    folder.mkdir(exist_ok=True)
    target=folder/(source.stem+'.obj')
    script=folder/'sr1_blender_fbx_convert.py'
    script.write_text(BLENDER_SCRIPT,encoding='utf8')
    if not target.is_file() or target.stat().st_mtime < source.stat().st_mtime:
        cmd=[locate_blender(blender_path),'--background','--factory-startup','--python',str(script),'--',str(source),str(target)]
        completed=subprocess.run(cmd,capture_output=True,text=True,timeout=240)
        if completed.returncode!=0 or not target.is_file():
            raise RuntimeError('FBX conversion failed. Blender output:\n'+(completed.stdout+'\n'+completed.stderr)[-6000:])
    return str(target)
