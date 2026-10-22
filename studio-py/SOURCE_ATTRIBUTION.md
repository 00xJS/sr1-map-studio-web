# Source attribution

SR1 Halo Map Studio v0.18 includes a Python port/adaptation of map-format algorithms from the **Saints Reborn Map Converter** source supplied by the user in this project.

The supplied Blender extension manifest identifies the project as **Saints Reborn Map Exporter**, maintainer **whompay**, licensed **GPL-3.0-or-later**. The source-derived Python code is primarily in `sr_reborn_core.py` and `sr_reborn_bridge.py` and is distributed under GPL-3.0-or-later.

The original source concepts ported here include:

- `.bbchunk_xbox2` section parsing and aligned rewriting;
- editable geometry/material-table parsing;
- BBChunk texture-string/material indirection;
- Havok `PPOM` / MOPP tree generation and validation;
- Saints Row `.vpp_xbox2` packfile parsing;
- Xbox 360 PEG texture-package structure and append semantics.

See `LICENSE_GPL-3.0.txt` for the GPLv3 license text.
