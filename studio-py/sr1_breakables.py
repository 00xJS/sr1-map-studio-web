"""SR1 BBChunk breakables diagnostics; non-mutating and fail-closed.

Known structures (retail XEX): header +0x364 source count (80-byte records),
header +0x380 shatter record count (24-byte records), +0x38c 28-byte group count.
These counts do not establish that a given object breaks: collision and damage
handling are separate. No render flags are changed by this module.
"""
from __future__ import annotations
import argparse
import json
import struct
from pathlib import Path

MAGIC = 0xBBCACA12
VERSION = 85
HEADER_SIZE = 0x3C8


def inspect_bbchunk(path):
    path = Path(path)
    with path.open('rb') as handle:
        header = handle.read(HEADER_SIZE)
    if len(header) < HEADER_SIZE:
        raise ValueError('BBChunk is shorter than its 0x3C8-byte header')
    get32 = lambda pos: struct.unpack_from('>I', header, pos)[0]
    magic, version = get32(0), get32(4)
    if magic != MAGIC:
        raise ValueError('Incorrect BBChunk magic: 0x%08X' % magic)
    if version != VERSION:
        raise ValueError('Expected retail version 85; found %d' % version)
    counts = {
        'source_records_80b': get32(0x364),
        'glass_records_24b': get32(0x380),
        'group_records_28b': get32(0x38C),
    }
    return {
        'file': str(path.resolve()), 'bytes': path.stat().st_size,
        'magic': '0x%08X' % magic, 'version': version,
        'counts': counts,
        'source_glass_index_offset': '0x30',
        'source_damage_name_offset': '0x40',
        'source_transform_indexes': ['0x3C', '0x44'],
        'notes': [
            'Counts are read from the on-disk big-endian BBChunk header.',
            'A zero 24-byte glass-record count does not prove the level has no other breakables.',
            'Native breakability also depends on damage definitions, object instances, and collision.',
            'OBJ/MTL alone cannot encode Saints Row 1 shatter assets or damage states.',
            'This tool does not modify collision or object/instance flags.',
        ],
    }


def compare_breakables(reference_path, generated_path):
    a, b = inspect_bbchunk(reference_path), inspect_bbchunk(generated_path)
    lost = {name: {'reference': n, 'export': b['counts'][name]}
            for name, n in a['counts'].items()
            if n > b['counts'][name]}
    return {
        'reference': a, 'export': b, 'count_reductions': lost,
        'native_breakables_preserved': 'NOT VERIFIED',
        'warning': ('Resource counts were reduced. Importing OBJ geometry is not a preservation '
                    'method for donor destructible definitions.' if lost else
                    'No count reduction was detected, but preservation of breakable behavior is NOT proven.'),
    }


def main():
    ap = argparse.ArgumentParser(description='Inspect BBChunk object/glass table counts without modifying map data')
    ap.add_argument('bbchunk')
    ap.add_argument('--compare', help='An exported BBChunk to compare against the first file')
    ap.add_argument('--output', help='Optional JSON report path')
    args = ap.parse_args()
    report = compare_breakables(args.bbchunk, args.compare) if args.compare else inspect_bbchunk(args.bbchunk)
    data = json.dumps(report, indent=2)
    if args.output: Path(args.output).write_text(data+'\n', encoding='utf-8')
    print(data)

if __name__ == '__main__': main()


def reconcile_legacy_targets(available_materials, selected_materials, native_breakables=0):
    """Reconcile old *planning-only* material targets with the composed OBJ.

    Native breakable meshes are intentionally removed from the static scene
    OBJ before export. Their old objNNN_material names may remain in a saved
    project's legacy breakable-target text field. Those targets have NEVER
    generated damage or collision; they are not the native-breakable entities.

    Keep strict missing-target validation when there are no native prefabs to
    explain a stale reference. With native prefabs, skip unavailable metadata
    targets and return them explicitly so the export log/report is transparent.
    """
    known = set(available_materials)
    requested = list(dict.fromkeys(str(x).strip() for x in (selected_materials or []) if str(x).strip()))
    removed = [name for name in requested if name not in known]
    if removed and not native_breakables:
        raise ValueError('Breakables targets not found in OBJ materials: ' + ', '.join(removed))
    return [name for name in requested if name in known], removed


def build_breakables_plan(materials, selected_materials, donor_path=None, generated_path=None):
    """Preparation-only plan: never writes guessed native damage/collision references."""
    materials=list(materials)
    targets=list(dict.fromkeys(str(x).strip() for x in selected_materials if str(x).strip()))
    unknown=sorted(set(targets)-set(materials))
    if unknown:
        raise ValueError('Breakables targets not found in OBJ materials: '+', '.join(unknown))
    donor=inspect_bbchunk(donor_path) if donor_path else None
    generated=inspect_bbchunk(generated_path) if generated_path else None
    glass_count=(donor or {}).get('counts',{}).get('glass_records_24b',0)
    warnings=[]
    if targets and not donor: warnings.append('Breakable target materials selected, but no donor BBChunk was provided.')
    if targets and donor and glass_count==0: warnings.append('Donor has no entries in the confirmed 24-byte glass table; it cannot supply native glass shatter definitions through this path.')
    if targets: warnings.append('Material targets are metadata only. Native destructible source records, damage states, and collision transition are NOT generated.')
    return {
      'format':'sr1-studio-breakables-plan-v1',
      'target_materials':targets,
      'all_obj_materials':materials,
      'donor':donor,
      'generated':generated,
      'donor_to_export_comparison':compare_breakables(donor_path,generated_path) if donor_path and generated_path else None,
      'native_breakables_created':0,
      'native_transplant_enabled':False,
      'status':'PREPARATION_ONLY',
      'warnings':warnings,
      'next_requirements':['A donor with confirmed native breakable entries and related asset dependencies',
        'Correct source-record relocation and native instance linkage for new exported objects',
        'Verified damage-definition names and appropriate break-state collision updates'],
      'collision_policy':'UNMODIFIED: never change render-instance flags to imitate damage',
    }



def build_breakable_geometry_manifest(obj_path, target_materials, world_scale=1.0, mirror_x=False):
    """Return deterministic OBJ triangle indices and bounds for planned breakables.

    This records source OBJ triangles, not independent engine destructible entities.
    Coordinates match the scale/mirror convention but do not apply map centering.
    """
    from collections import defaultdict
    from sr1_obj_core import parse_obj_attrs
    obj=parse_obj_attrs(obj_path)
    targets=set(target_materials)
    groups=defaultdict(list)
    for index, face in enumerate(obj['faces']):
        if face[3] in targets:
            groups[face[3]].append(index)
    result=[]
    for material in sorted(targets):
        indices=groups.get(material, [])
        points=[]
        for i in indices:
            for vertex_index in obj['faces'][i][:3]:
                x,y,z=obj['verts'][vertex_index]
                points.append(((-x if mirror_x else x)*world_scale,y*world_scale,z*world_scale))
        bounds=([min(p[j] for p in points) for j in range(3)],
                [max(p[j] for p in points) for j in range(3)]) if points else None
        result.append({'material':material,'triangle_count':len(indices),
                       'source_obj_triangle_indices':indices,
                       'scaled_untranslated_bounds':{'min':bounds[0],'max':bounds[1]} if bounds else None})
    return {'format':'sr1-breakables-geometry-manifest-v1',
            'source_obj':str(Path(obj_path).resolve()),
            'selected_materials':result,
            'total_selected_triangles':sum(v['triangle_count'] for v in result),
            'total_obj_triangles':len(obj['faces']),
            'native_entities_created':0,
            'collision_policy':'unchanged',
            'coordinate_note':'Bounds scaled and optionally mirrored in X; map-center translation not applied.',
            'warning':'Triangle selection metadata only. No damage definitions, shatter meshes, or runtime entities created.'}
