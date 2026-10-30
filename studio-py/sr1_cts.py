"""CTS spawn/marker writer adapted from mapconv/src/build.cpp.
Preserves all existing CTS sections, appends unique names into matching sections.
Only explicit CTS template selection enables native output.
"""
from pathlib import Path
import math
import re

# Names and CTS fields below are transcribed from the supplied retail CTS samples.
# The game has "pimp enter" but no "pimp exit": see TRIGGER_ACTIONS.
SPECIAL_SPAWN_TYPES = ('Beer Chat', 'Beer Stand', 'Bouncer', 'Bum at fire', 'Dance pair c', 'Dance pair d', 'Dancer', 'Dead body', 'Drinking 40', 'Drunk vomit', 'Fountain', 'Gang Cluster', 'Gang Cluster2', 'Gang Sitting', 'Gang Standing', 'Gravesite', 'Jackhammering', 'Lounge', 'NPC busted', 'Ped Dance Cluster', 'Reading news', 'SH Gang Cluster', 'Sitting', 'Sitting paper', 'Sitting reading', 'Sleeping', 'Smoking Weed', 'Store browse bling', 'Store browse gun', 'Store browse wine', 'Stripper and fans', 'Suicide')
HUMAN_CHAR_TYPES = ('LC_X_F_Thug1-01_A', 'LC_X_M_Killa1-01', 'LC_X_M_Killa2-01', 'LC_X_M_Thug1-01', 'LC_X_M_Thug2-01', 'LC_X_M_Thug2-02', 'TS_X_M_Killa-A', 'TS_X_M_KillaB', 'TS_X_M_Thug1-01', 'TS_X_M_Thug1-01b', 'TS_X_M_Thug2-01', 'VK_X_M_Killa1-02', 'VK_X_M_Killa1-03', 'VK_X_M_Thug1-02', 'VK_X_M_Thug2-02', 'VK_X_M_killa1-01', 'WR_X_F_Thug1-01', 'WR_X_F_Thug1-02', 'WR_X_M_Killa2-01', 'WR_X_M_Killa2-03', 'WR_X_M_Thug2-01')

SPAWN_KINDS = {'Shared spawn','Red team spawn','Blue team spawn'}
TRIGGER_KINDS = {'Chains drop-off','Pimp entrance','Sphere trigger (custom)'}
# The names the game's $Trigger action reader knows, in its order (table at 0x82038650, compared ignoring case).
# Any other name is logged as a parse error and read as index 0, "execute lua script" (0x82635DF8).
TRIGGER_ACTIONS = ('execute lua script', 'chains drop off', 'multiplayer chop shop', 'blinged victory', 'blinged chop shop entrance', 'pimp enter', 'crib clothing', 'crib weapons', 'cash pickup', 'garage enter', 'garage interior', 'save vehicle', 'multiplayer_crib', 'pushback control point', 'stronghold', 'tagging', 'enter hidden clinic', 'repair vehicle', 'player creation', 'plastic surgeon', 'hair salon', 'tattoo parlor', 'clothing store', 'jewelry store', 'theatre', 'hospital', 'police station', 'liquor store', 'freckle bitches', 'music store', 'weapon store', 'forgive and forget', 'car mechanic', 'car dealership', 'train station', 'medic', 'save spot', 'callback', 'double callback', 'audio region', 'interior region')
# $Trigger max fires is kept in one byte (0x824EB788: stb to +286), so 256 would read as 0.
MAX_TRIGGER_FIRES = 255
NAV_KINDS = {'Ground navpoint','Floating navpoint'}
CATEGORIES = SPAWN_KINDS | TRIGGER_KINDS | NAV_KINDS | {'Weapon pickup','Vehicle spawn','Special spawn','Human NPC spawn'}
SECTION_FOR = {**{k:'#Respawns' for k in SPAWN_KINDS},
               **{k:'#Triggers' for k in TRIGGER_KINDS},
               **{k:'#Navpoints' for k in NAV_KINDS},
               'Weapon pickup':'#Items','Vehicle spawn':'#Vehicles',
               'Special spawn':'#Special Spawns','Human NPC spawn':'#Humans'}
ORDER = ['#Groups','#Navpoints','#Cameras','#Items','#Triggers','#Vehicles','#Respawns','#Humans','#Special Spawns']
# Original seven headings exist in every supported CTS skeleton; extra sections
# are requested only if corresponding marker types actually need them.
REQUIRED_HEADINGS = ['#Navpoints','#Cameras','#Items','#Triggers','#Vehicles','#Respawns','#Humans']



def compute_normalization_bounds(points):
    """Use the same center-XZ/ground-Y pivot as beaver_bbchunk.transform_obj_for_sr1."""
    points=list(points)
    if not points: raise ValueError('No scene geometry: cannot determine map origin')
    lo=[min(float(p[k]) for p in points) for k in range(3)]
    hi=[max(float(p[k]) for p in points) for k in range(3)]
    if not all(math.isfinite(x) for x in lo+hi):raise ValueError('Invalid scene geometry bounds')
    return ((lo[0]+hi[0])/2.0,lo[1],(lo[2]+hi[2])/2.0)


def convert_xyz(point, scale, mirror_x, origin=(0.,0.,0.), coordinate_space='scene'):
    if len(point)!=3: raise ValueError('Marker position must contain XYZ')
    p=tuple(float(n) for n in point)
    if not all(math.isfinite(n) for n in p): raise ValueError('Marker position is not finite')
    if coordinate_space=='game':return p
    if coordinate_space!='scene':raise ValueError('Invalid marker coordinate space')
    if origin is None: raise ValueError('Map geometry origin is required for scene-space markers')
    if len(origin)!=3: raise ValueError('Invalid origin')
    o=tuple(float(n) for n in origin)
    if not all(math.isfinite(n) for n in o):raise ValueError('Invalid origin')
    x,y,z=((p[i]-o[i])*scale for i in range(3))
    return (-x if mirror_x else x, y, z)


def convert_yaw(yaw_degrees, mirror_x, coordinate_space='scene'):
    degree=float(yaw_degrees)
    if not math.isfinite(degree):raise ValueError('Invalid yaw')
    if coordinate_space=='scene' and mirror_x: degree=-degree
    elif coordinate_space not in ('scene','game'):raise ValueError('Invalid marker coordinate space')
    return math.radians(degree)


def _text_id(s):
    result=re.sub(r'[^A-Za-z0-9_]', '_', s)
    if not result: raise ValueError('Invalid map id')
    return result


def _nav(name, pos, yaw, map_id):
    return (f'$Navpoint:\t"{name}"\n$Type:\t\t"ground"\n'
            f'$Pos:\t\t\t<{pos[0]:.6f} {pos[1]:.6f} {pos[2]:.6f}>\n'
            f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{map_id}"\n\n')


def _append_section(text, header, body):
    if not body:return text
    # Exact standard comment headings; do not confuse with text in other fields.
    lines=list(re.finditer(r'(?m)^#[A-Za-z][A-Za-z0-9 ]*\s*$',text))
    matches=[m for m in lines if m.group().strip()==header]
    if len(matches)!=1: raise ValueError(f'Expected exactly one {header} section in the CTS template')
    idx=lines.index(matches[0]); end=lines[idx+1].start() if idx+1<len(lines) else len(text)
    return text[:end].rstrip()+ '\n\n' + body + text[end:]


def _quoted(s, field):
    """Keep all user-controlled identifiers inside a single CTS string literal."""
    value=str(s).strip()
    if not value or any(ch in value for ch in ('"','\n','\r','\x00')):
        raise ValueError('Invalid '+field+' (must be a nonempty single-line CTS identifier)')
    return value


def build_cts(template_text, markers, map_id, scale=1.0, mirror_x=True, origin=(0.,0.,0.), coordinate_space="scene", replace_respawns=False):
    """Append native CTS records to a template without altering unrelated sections.

    report['limits'] holds what the creator should read in the export log: values
    changed or written that the game will not take as they stand.
    """
    map_id=_text_id(map_id)
    if not math.isfinite(float(scale)) or float(scale)<=0: raise ValueError('Invalid world scale')
    text=template_text.replace('\r\n','\n').replace('\r','\n')
    for header in REQUIRED_HEADINGS:
        if not re.search(r'(?m)^'+re.escape(header)+r'\s*$',text):
            raise ValueError('CTS template missing section '+header)
    if replace_respawns:
        text=_clear_respawns_and_spawn_navs(text)
    used=set(re.findall(r'"([^"\n]+)"',text))
    sections={name:[] for name in ORDER}
    counters={'spawn':0,'weapon':0,'vehicle':0,'chains':0,'pimp_in':0,
              'trigger':0,'ground_nav':0,'floating_nav':0,'special':0,'human':0}
    report={'counts':{},'warnings':[],'limits':[],'preserved_existing_cts':True,'injected_names':[],
            'map_origin':list(origin) if origin is not None else None,
            'coordinate_space':coordinate_space, 'exported_positions':[]}
    group_ids={}
    special_count=0
    chains_on=0
    for m in markers:
        kind=m.get('type')
        if kind not in CATEGORIES: raise ValueError('Unsupported marker category: '+str(kind))
        label=str(m.get('label','')).strip()
        if kind in ('Weapon pickup','Vehicle spawn'):
            _quoted(label,kind+' item ID')
        pos=convert_xyz(m['position'],float(scale),bool(mirror_x),origin,coordinate_space)
        report['exported_positions'].append({'type':kind,'editor':list(m['position']),'game':list(pos)})
        yaw=convert_yaw(m.get('yaw',0),bool(mirror_x),coordinate_space)
        category=('spawn' if kind in SPAWN_KINDS else 'weapon' if kind=='Weapon pickup'
                  else 'vehicle' if kind=='Vehicle spawn' else 'chains' if kind=='Chains drop-off'
                  else 'pimp_in' if kind=='Pimp entrance'
                  else 'trigger' if kind=='Sphere trigger (custom)' else 'ground_nav' if kind=='Ground navpoint'
                  else 'floating_nav' if kind=='Floating navpoint' else 'special' if kind=='Special spawn'
                  else 'human')
        prefixes={'spawn':'respawn','weapon':'item','vehicle':'veh','chains':'chains',
                  'pimp_in':'pimp_enter','trigger':'trigger',
                  'ground_nav':'nav','floating_nav':'floatnav','special':'special','human':'human'}
        while True:
            index=counters[category];counters[category]+=1
            name=f'{map_id}__studio_${prefixes[category]}{index:03d}'
            if name not in used:break
        used.add(name);report['injected_names'].append(name)
        if kind=='Special spawn':
            activity=_quoted(m.get('special_type','Reading news'),'special spawn activity')
            sections['#Special Spawns'].append(
                f'$Special Spawn:\t"{name}"\n$Type:\t\t"{activity}"\n'
                f'$Pos:\t\t\t<{pos[0]:.6f} {pos[1]:.6f} {pos[2]:.6f}>\n'
                f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{map_id}"\n\n')
            special_count+=1
        else:
            nav_type='floating' if kind=='Floating navpoint' else 'ground'
            sections['#Navpoints'].append(
                f'$Navpoint:\t"{name}"\n$Type:\t\t"{nav_type}"\n'
                f'$Pos:\t\t\t<{pos[0]:.6f} {pos[1]:.6f} {pos[2]:.6f}>\n'
                f'$Orient:\t\t[{yaw:.6f}]\n+Chunk:\t\t"{map_id}"\n\n')
            if kind in SPAWN_KINDS:
                team=1 if kind=='Red team spawn' else 2 if kind=='Blue team spawn' else 0
                block=(f'$Respawn:\t\t"{name}"\n$Start nav:\t\t"{name}"\n'
                       '$Box size:\t\t-2.000000 0.000000 -2.000000 2.000000 2.000000 2.000000\n')
                if team:block+=f'+MPTeam{team}\n'
                sections['#Respawns'].append(block+'\n')
            elif kind=='Weapon pickup':
                sections['#Items'].append(f'$Item:\t\t"{name}"\n$Item type:\t"{label.replace("-"," ")}"\n$Start nav:\t"{name}"\n\n')
            elif kind=='Vehicle spawn':
                sections['#Vehicles'].append(f'$Vehicle:\t\t"{name}"\n$Vehicle type:\t"{label}"\n$Start nav:\t\t"{name}"\n$Stream Distance:\t\t\t50.000\n\n')
            elif kind in TRIGGER_KINDS:
                action=('chains drop off' if kind=='Chains drop-off' else 'pimp enter' if kind=='Pimp entrance'
                        else _quoted(m.get('trigger_action',''),'custom trigger action'))
                radius=float(m.get('radius',.7));delay=int(m.get('delay_ms',10000))
                max_fires=int(m.get('max_fires',0))
                if not math.isfinite(radius) or not 0<radius<=1000:raise ValueError('Invalid trigger radius')
                if not 0<=delay<=1000000:raise ValueError('Invalid trigger delay')
                if max_fires<0:raise ValueError('Invalid trigger max fires')
                if max_fires>MAX_TRIGGER_FIRES:
                    report['limits'].append(f'A trigger had max fires {max_fires}: lowered to {MAX_TRIGGER_FIRES}, the most the game can store')
                    max_fires=MAX_TRIGGER_FIRES
                if action.lower() not in TRIGGER_ACTIONS:
                    report['limits'].append(f'The game has no "{action}" trigger action: it logs an error and treats the trigger as "execute lua script", so it does nothing')
                # Most of the game's own drop-offs have no +Disabled: 17 of 21 on its MP maps, and only mp_bac_03 uses it (on 4 of 5).
                disabled=m.get('disabled',kind!='Chains drop-off')
                if kind=='Chains drop-off' and not disabled:chains_on+=1
                sections['#Triggers'].append(
                    f'$Trigger:\t\t\t\t"{name}"\n$Trigger type:\t\t\t"sphere"\n'
                    f'$Trigger action:\t\t"{action}"\n$Trigger max fires:\t{max_fires}\n'
                    f'$Trigger delay:\t\t{delay}\n$Start nav:\t\t\t\t"{name}"\n'
                    + ('+Disabled\n' if disabled else '')
                    + f'$Sphere radius:\t\t{radius:.6f}\n\n')
            elif kind=='Human NPC spawn':
                character=_quoted(m.get('char_type',''),'human character type')
                leash=float(m.get('leash_distance',10.0))
                if not math.isfinite(leash) or not 0<=leash<=10000:raise ValueError('Invalid human leash distance')
                block=(f'$Human:\t\t\t\t"{name}"\n$Char type:\t\t\t\t"{character}"\n'
                       f'$Start nav:\t\t\t\t"{name}"\n+Leash distance:\t\t{leash:.2f}\n')
                group=str(m.get('group','')).strip()
                if group:
                    _quoted(group,'NPC group')
                    group_key=_text_id(group)
                    if not group_key: raise ValueError('Invalid NPC group')
                    if group_key not in group_ids:
                        group_name=f'{map_id}__studio_$G_{group_key}'
                        if group_name not in used:
                            sections['#Groups'].append(f'$Group:\t"{group_name}"\n')
                            used.add(group_name)
                        group_ids[group_key]=group_name
                    block+=f'+Group:\t\t\t\t"{group_ids[group_key]}"\n'
                sections['#Humans'].append(block+'\n')
        report['counts'][kind]=report['counts'].get(kind,0)+1
    # Standard generated CTS skeleton has #Special Spawns, but older hand-made
    # templates might omit it. Fail *before* writing a truncated output.
    for heading in ORDER:
        if sections[heading] and not re.search(r'(?m)^'+re.escape(heading)+r'\s*$',text):
            raise ValueError('CTS template missing required section '+heading)
    for heading in reversed(ORDER):
        text=_append_section(text,heading,''.join(sections[heading]))
    if not markers:report['warnings'].append('No markers added')
    if report['counts'].get('Chains drop-off') and not chains_on:
        report['limits'].append("Every Chains drop-off starts switched off, which none of the game's own maps does. Not tested in game")
    spawn_count=sum(report['counts'].get(k,0) for k in SPAWN_KINDS)
    if spawn_count<4: report['warnings'].append('mapconv recommends at least 4 spawns; ideally 8 or more')
    report['warnings'].append('Template retains existing chunk/include references; check they match your installed map')
    report['warnings'].append('Marker facing and gameplay activation still require an in-game test')
    return text,report


def export_cts(template_file, output_file, markers, map_id, scale, mirror_x, origin=(0.,0.,0.), coordinate_space="scene"):
    src=Path(template_file)
    if not src.is_file(): raise FileNotFoundError(str(src))
    content=src.read_text(encoding='utf-8-sig')
    result,report=build_cts(content,markers,map_id,scale,mirror_x,origin,coordinate_space)
    out=Path(output_file)
    if src.resolve()==out.resolve():raise ValueError('Output must not overwrite input CTS')
    out.parent.mkdir(parents=True,exist_ok=True)
    out.write_text(result,encoding='utf-8',newline='\r\n')
    return out,report


def _clear_respawns_and_spawn_navs(text):
    """Remove respawn records and linked navpoints from a CTS template."""
    def get_section(t,name):
        match=re.search(r'(?m)^'+re.escape(name)+r'\s*$',t)
        if not match:raise ValueError('CTS is missing '+name)
        next_header=re.search(r'(?m)^#[A-Za-z][A-Za-z0-9 ]*\s*$',t[match.end():])
        end=match.end()+next_header.start() if next_header else len(t)
        return match.end(),end
    a,b=get_section(text,'#Respawns')
    block=text[a:b]
    navs=set(re.findall(r'(?m)^\$Start nav:\s*"([^"]+)"',block))
    text=text[:a]+'\n// Only explicitly placed Map Studio respawns\n\n'+text[b:]
    a,b=get_section(text,'#Navpoints')
    nav_section=text[a:b]
    # Navpoint blocks begin at $Navpoint; preserve navpoints not referenced by removed respawns.
    chunks=re.split(r'(?m)(?=^\$Navpoint:)',nav_section)
    kept=[]
    for chunk in chunks:
        m=re.match(r'\$Navpoint:\s*"([^"]+)"',chunk)
        if m and m.group(1) in navs:continue
        kept.append(chunk)
    return text[:a]+''.join(kept)+text[b:]


def validate_spawn_links(cts_text, expected_count):
    a=re.search(r'(?ms)^#Respawns\s*$(.*?)(?=^#[A-Za-z])',cts_text)
    b=re.search(r'(?ms)^#Navpoints\s*$(.*?)(?=^#[A-Za-z])',cts_text)
    if not a or not b:raise ValueError('Missing CTS sections')
    refs=re.findall(r'(?m)^\$Start nav:\s*"([^"]+)"',a.group(1))
    names=set(re.findall(r'(?m)^\$Navpoint:\s*"([^"]+)"',b.group(1)))
    if len(refs)!=expected_count:raise ValueError(f'Expected {expected_count} respawns; found {len(refs)}')
    missing=[ref for ref in refs if ref not in names]
    if missing:raise ValueError('Respawn navpoint reference(s) missing: '+repr(missing))
    return True
