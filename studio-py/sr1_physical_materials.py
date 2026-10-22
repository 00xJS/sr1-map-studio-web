"""Retail SR1 Xbox 360 physical material mapping recovered from XEX tables
0x82039F50 (labels), 0x82039FA8 (suffixes) and sub_82194458.
Static filename validation cannot guarantee in-game registration order.
"""
import re
import hashlib

MATERIALS = (
    ('Concrete','co'), ('Cardboard','cb'), ('Carpet','ca'), ('Ceramic','ce'),
    ('Dirt','dt'), ('Drywall','dw'), ('Flesh','fl'), ('Foliage','lv'),
    ('Glass Heavy','gh'), ('Glass Medium','gm'), ('Glass Light','gl'),
    ('Grass','gs'), ('Gravel','gv'), ('Marble','ma'), ('Metal Fence','fm'),
    ('Metal Solid','me'), ('Metal Thin','tm'), ('Plastic','pl'),
    ('Rubber','rb'), ('Sand','sa'), ('Water','wa'), ('Wood','wo'),
)
SUFFIXES = tuple(code for _, code in MATERIALS)
NAMES = tuple(name for name, _ in MATERIALS)

def suffix_for_id(surface_id):
    sid = int(surface_id)
    if not 0 <= sid < len(MATERIALS):
        raise ValueError('Physical material ID must be between 0 and 21')
    return SUFFIXES[sid]

def name_for_export(map_name, index, surface_id, source_path=None, use_alpha=False):
    # Resource names are cached by name at runtime. Never reuse a previous
    # name for DIFFERENT image bytes or alpha semantics on a later export.
    # Include the slot so identical images retain separate unambiguous bindings.
    # Keep the physical-material suffix recognized by SR1 and the 28-byte PEG cap.
    from pathlib import Path
    base = re.sub('[^a-zA-Z0-9_]', '_', map_name).lower()[:8]
    suffix = suffix_for_id(surface_id)
    if source_path is None:
        raise ValueError('Texture source is required for collision-safe resource naming')
    h = hashlib.sha256()
    with Path(source_path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    h.update(b'\x01' if use_alpha else b'\x00')
    name = '%s_%03x_%s_%s.tga' % (base, int(index), h.hexdigest()[:8], suffix)
    if len(name.encode('ascii')) >= 29:
        raise ValueError('Export texture name too long: ' + name)
    return name

def classify_bitmap_name(name):
    # sub_82194458: exact _XX sequence before the filename extension.
    m = re.search(r'_([a-zA-Z]{2})\.[^.]+$', str(name))
    if not m:
        return 0
    code = m.group(1).lower()
    return SUFFIXES.index(code) if code in SUFFIXES else 0
