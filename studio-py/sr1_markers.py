"""Portable gameplay marker sidecar. Does NOT patch native SR1 map packages."""
import json
import sr1_cts
from pathlib import Path
MARKER_TYPES=tuple(sorted(sr1_cts.CATEGORIES))
def save_markers(path,markers,world_scale=1.0,mirror_x=True,origin=(0.,0.,0.),coordinate_space="scene"):
    out=[]
    for m in markers:
        if m['type'] not in MARKER_TYPES: raise ValueError('Unknown marker type: '+str(m['type']))
        p=[float(x) for x in m['position']]
        if len(p)!=3: raise ValueError('Marker needs XYZ')
        out.append({'type':m['type'],'label':str(m.get('label','')), 'editor_position':p, 'editor_yaw_degrees':float(m.get('yaw',0)), 'properties':{k:v for k,v in m.items() if k not in ('type','label','position','yaw')}, 'suggested_game_position':list(sr1_cts.convert_xyz(p,world_scale,mirror_x,origin,coordinate_space))})
    path=Path(path); path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps({'format':'sr1-map-studio-markers-v1','native_markers_exported':False,'map_source_pivot':list(origin),'marker_coordinate_space':coordinate_space,'coordinate_note':'Calculated positions use the same map pivot and scale as BBChunk; facing requires game verification.','markers':out},indent=2),encoding='utf-8')
    return path
