# Decoy dummies: research and plan

> **Status (2026-10-27):** phase 2 is built on branch `decoy-dummies` with the recommended choices: body boxes for
> collision, player decoys plus the NPC list in section 6, a cap of 12, the five hand-set poses, and moving decoys
> left for a later companion-mod track. Where the code lives is in `docs/DEVELOPING.md` (`src/lib/dummies/`).
> Nothing is tried in game yet.

Phase 1 findings for a "Dummy" piece: real Saints Row 1 player or character models standing in a map as static,
posed decoys, like clothing-store mannequins, to distract from real players in a game mode. Nothing here has been
tried in game. Claims are marked **H** (read in code or measured on a local install), **M** (inference) or
**L** (guess).

Measurements come from a local install read in the browser code's own readers (`src/lib/sr1char/*`, run under
vite-node). Nothing from the game is copied into the repo, now or in the build: as with the walk-through player and
"From my game", every mesh and picture is built in the user's browser from their own packfiles and stored as
`origin: 'game'`.

## 1. Other models (H)

The same `cmesh`, `morph`, `peg` and `rig` readers load other characters unchanged. Every one tried parsed:
gang thugs of all four gangs, police, SWAT and pedestrians, male and female.

| What | Where | Count |
|---|---|---|
| Character meshes (`.cmesh_xbox2`), their pictures (`.peg_xbox2`) and morphs | `cmesh_stream.vpp_xbox2` (morphs also in `morph_stream.vpp_xbox2`) | 1,086 meshes (characters, clothing items, cutscene props) |
| Skeletons (`.rig_xbox2`) | `preload.vpp_xbox2` | 246 |
| Character table (mesh, rig, anim set, team, skin-tone variants) | `character.xtbl` in `misc2.vpp_xbox2` | 360 characters |
| Player clothing and hair items (mesh name, colour variants, MP price) | `customization_items.xtbl`; hidden body regions in `player_cust.xtbl` (both `misc2`) | 1,463 item variants |
| The four pedestrians always in memory | `initial_population_files.vpp_xbox2` | 4 |

Families by name prefix: `vk_` Vice Kings, `lc_` Los Carnales, `wr_` Westside Rollerz, `ts_` Third Street Saints,
`lw_` law (officer, FBI, SWAT, EMT, security), `pd_` pedestrians, `ac_` activity characters, `cs_` cutscene props.

Two kinds of model:

- **The player** (`pc_body` plus separate clothing and hair meshes) is what `player.ts` builds today. Real players
  in a match are this model, dressed from the same customization items (each item has an `MPPrice`), so this is the
  most convincing decoy.
- **An NPC** is one whole-body mesh holding every variant: several heads and skin tones and alternate outfit
  pieces as separate materials, picked by visibility ids (VIDs), as the player body's regions are. A Vice Kings
  thug has 25 materials and 48 VID groups (16 per detail level), an officer 17 materials, a young pedestrian
  64 materials. Where the VID-to-variant table lives isn't found yet (M: `character.xtbl` names variants "White"
  and "Black" with skin tones, but not their VIDs). The first version can pick by VID group.

Every NPC skeleton tried (VK, LC, Saints thugs, officer, both pedestrians, `gml1`, `pml1`) has the player's 64 bones
with the same names; head heights are 1.53 to 1.56 m (H). So one set of poses fits every model. `pfl1.rig_xbox2`
uses another layout and fails to parse; skip it.

Gaps to fill for NPCs:
- **Shaders.** NPCs use four shaders: `271c54d3` skin, `fb48c18d` cloth with decals and fabric detail,
  `7b96e38e` and `b5cf6daf` (H). `materials.ts` already ports the player's cloth shader. The NPC skin shader
  (diffuse at slot `12cb5c0b`, plus specular and subsurface) needs a small port.
- **Shared pictures.** Eyes, teeth and flat normals (`Eye_Blue02.tga`, `Basic_teeth01.tga`, `flat-normalmap.tgn`)
  aren't in the character's own peg (H). They live in a shared peg not yet located (M). Until then, use plain
  colours: eyes and teeth are under 1% of the triangles.

## 2. Poses (H for the bake, M for the poses)

`rig.ts` has what a bake needs: `skinMatrices(rig, rotations, offsets)` and `skinPositions(...)`, which are linear
blend skinning on the CPU. `player.ts` already uses them to stand the character on the ground. A bake is:

1. Choose bone rotations: the creator's standing pose (`standingPose`), with optional changes on top.
2. `skinPositions` on each part's morphed positions. Add a matching `skinNormals` (the rotation part of the same
   matrices) so lighting is right.
3. Map game space to the editor: x2 scale, Z mirrored (as `player.ts` does), feet at the origin, facing -Z.
   Then write an OBJ in the exporter's convention (`place.ts objText`, which also mirrors X and swaps corners).

Poses for the first version, hand-set as bone rotations like the walk and crouch drive in `player.ts`:

| Pose | How |
|---|---|
| Standing | The creator pose, as captured from the running game (exact) |
| Relaxed | Standing with the arms lowered further |
| Crouch | The existing crouch drive at k = 1 (hips, knees, feet flat, back and head) |
| Aim (pistol) | Right upper arm and forearm raised forward, head turned to the hand |
| Mannequin | Arms out at about 45 degrees, the shop-window look |

The game's own idles and aims are in `preload.vpp_xbox2`: 2,025 `.anim_xbox2` files, for example
`gml1_bs_sd_idle_a`, `gml1_pa_ps_aim_st` and `copidle` (H). No reader for that format exists, here, in
SR1-Creator or in the research repo. Reading one frame of a game animation would give exact game poses, but it is
a separate format job (L to M effort), so it is left for later.

## 3. Cost (H, measured)

| Model | Triangles drawn | Material slots | Pictures |
|---|---|---|---|
| Default player (`buildPlayer`, 8 parts) | 5,152 | 24 slots, about 12 after baking (eye-colour and hidden slots drop) | about 1 MB in the PEG (mostly 512 x 512 DXT1) |
| VK thug, one variant (LOD 0) | about 4,500 (14,330 across all variants) | about 10 of 25 | similar |
| Officer, LOD 0 | about 5,200 | about 12 of 17 | similar |
| NPC low-detail levels (records 1 and 2) | about 1,500 each (1,790 / 1,927 vertices) | same layout, stride 44 (H) | |

Each picture is stored once in the PEG (`py/shared_textures.py`). Baked pictures are deterministic, so dummies with
the same look share them, and only a new look adds its roughly 1 MB.

**Suggested cap: 12 per map** (warn at 8 different looks). 12 dummies add about 60k triangles, about a lobby's
worth, since retail MP holds 12 players. At 8 looks they add about 8 MB to the 28 MB PEG budget
(`textureBudget.ts`). The wizard plans maps to 150k triangles (`wizardPieces.ts TRI_BUDGET`). The cap and the
look warning feed the Check tab, like the texture budget.

## 4. Export path

### Map geometry, not a native prop (H)

Native props allow one material, 1 to 4,096 triangles each, and a capped number per map
(`sr1_native_limits.py`, `sr1_native_props.py configure`). A character has about 12 materials and about 5,000
triangles, so it can't be one. A baked dummy is an ordinary static scene item (`physics_intent: 'Static'`): an OBJ
plus one PNG per material, merged into the map's main geometry like any game object placed from "From my game"
(`gameObjects/place.ts storeObject`). No Python changes are needed.

A later option: a native movable prop from the low-detail mesh (about 1,500 triangles), with its pictures baked into
one atlas. That decoy would fall over when shot or bumped (the "Crate Small" profile) instead of standing like a
statue. It is untested and left for a later phase.

### How its textures get written

Each material's final colour is baked on the CPU into one PNG at the source picture's size, the way the editor's
shaders compute it:
- **Cloth:** diffuse x `diffuse_color`, then decals, then the fabric detail overlay.
- **Skin:** tint by the chosen saturation and luminosity, then mixed with the pigment map.
- **Hair:** diffuse with the hair colour, alpha kept.

They are stored with `storeFile(..., 'game')` and `origin = 'game'` set, as `storeObject` does. Hair, eyebrows and
stubble are `alpha: true`: the exporter writes them as DXT5 on its alpha-material template, the same path the
invisible stair ramps use (`sr_reborn_bridge.py`). Normal and specular maps are dropped from the export (the
exporter writes one picture per material). The editor can still draw them through the existing look file
(`lookFile.ts`).

### Collision: a body-shaped box set (recommended)

The render mesh gets `collision_disabled: true`. Character triangles would be fine-grained collision, and fingers
and hair cards would add the kind of slivers that made invisible walls (`py/collision_fix.py`).

The collider is a second item in the same group (groups move, turn and copy together). It is about 10 boxes, one
per body segment, placed from the posed skeleton: head, chest, hips, upper and lower arms, upper and lower legs.
That is about 120 triangles. It uses the generated "invisible" texture with `alpha: true` and surface Flesh (`fl`),
exactly like `stairActions.ts` does for the ramps. Because the boxes are made by the site from a recipe, they can be
shared. They follow the pose, and they sit within a few centimetres of the body, so bullets and players stop where
the body is.

Alternatives: one box around the whole body (simplest, but shots between the legs stop in the air), or the
character's own low-detail mesh as collision (closest fit, but it is game data, so shares would need the boxes
anyway).

### Where game data can't go

The dummy item carries a recipe, `dummy: { model, pose, look, ws }`, like `game_object` does. Its files are
`origin: 'game'`:

- **Backups:** `policy.ts gameObjectPaths` learns about `dummy` items. Backups leave the files out, and the
  opener's browser rebuilds them from their own game (like `rebuildItem`).
- **Shares, Play in browser for others, gallery, cloud, Showcase:** these already refuse or drop game-origin
  files. Instead of dropping the dummy, swap its mesh for a **site-made stand-in figure**: a low-poly mannequin
  (about 300 triangles) posed from the same pose table, so it stands the same way. It is drawn with a generated
  texture recipe, and the collider boxes are shared unchanged. The stand-in can be built without game files from
  a fixed set of bone positions (head at 1.56 m, measured above). Those are a handful of numbers, not game data.
- **The editor without a connected game folder:** shows the same stand-in.

## 5. Gameplay unknowns, for the in-game test sprint

| Question | What the code says | Test |
|---|---|---|
| **Do real players show overhead markers that decoys lack?** | Probably yes. The MP HUD loads `mp_player_life_full`/`_empty` and four gang arrows, `mp_player_arrow_lc/wr/vk/3ss` (name table `0x827AD30C`, handles from `0x8307EF4C`, loader `823D7D18`). The per-frame loop `8237F4A0` draws a health bar (`8237DF20`) over other players, and a gang arrow (`8237E2F8`) when the player's team (human `+3020`) matches the viewer's or a flag is set (H that they are drawn there, M that they float over players in the 3D view). Decoys are map geometry and get neither. | In Team Gangsta Brawl and Gangsta Brawl, look at a teammate, an enemy and a decoy at 5, 15 and 40 m: is there a bar or arrow over the real players? |
| **Aim assist** | `aim_assist_slow/steer` within `aim_assist_dist` 30 m pull a controller's aim onto humans (H, console vars). A decoy won't pull, so controller players can tell. | Aim across a decoy and a player with a controller. |
| **What happens when a decoy is shot?** | It is static map geometry: no health, no death, no ragdoll. Damage applies only to humans and vehicles (`824470D0`, server-side in MP) (H). The bullet stops on the Flesh-surface collider. Impact effects follow surface type, which may need early surface registration (`surface_registration` feature) (M). Bullet holes may draw on the invisible boxes, a few centimetres off the body (L). Explosions don't move it. Melee passes or stops on the boxes (M). | Shoot, punch and grenade a decoy. Look at impacts, holes, blood, the kill feed and the score. |
| **Shadows and lighting** | Real players get dynamic lighting and a shadow; map geometry is lit as map geometry (M). | Compare a decoy beside a player at noon. |
| **Minimap** | Real players may show as blips for teammates; decoys never do (M). | Look at the minimap with a teammate beside a decoy. |
| **Could moving decoys (real spawned NPCs) work in MP?** | Only through the companion mod. Ambient and spawn-group people are off in MP except Co-op (`824290D0`, `824131F0`); `_npcs.xtbl` is inert (H). A mod can spawn people from the update hook on the server: 12 person-model slots, 32 humans in MP, model references balanced, despawn hook `8244BC40` (H, saints-row-engine rules). NPCs replicate as type 6 objects (create `823A7DB0` carries position, rotation, model name and look) in Protect Tha Pimp and Co-op (H). Whether they replicate in Gangsta Brawl or Big Ass Chains isn't known (M). | A separate companion-mod track, after static decoys are tried: spawn one NPC on the host in Gangsta Brawl and see whether the client sees it. |

## 6. Look options

Practical in the first version:

- **Player decoy (the default), dressed like an MP player.** Body sliders come from a short list of face and body
  presets (the creator's slider values, as `player.ts` has one). Skin tone uses the creator's saturation and
  luminosity. Hair is a style from the `htop_*` meshes (49 found) and a colour from
  `player_creation_hair_color.xtbl`; facial hair is optional. The outfit is a top, bottom, shoes and an optional
  hat, glasses or coat, from `customization_items.xtbl` with a colour variant. Each item's hidden body regions come
  from `player_cust.xtbl Obscured_VIDs`. The lists are read from the user's own tables at run time; only preset
  item names go in the code, as `player.ts` already does. Presets: "New player" (the default outfit), plus one per
  gang colour (Saints purple, Vice Kings yellow, Los Carnales red, Westside Rollerz blue), to match MP team colours.
- **NPC decoy.** A curated list: one or two thugs per gang, officer, SWAT, a few pedestrians. Variant is by VID
  group (skin tone and outfit pieces); the first variant is the default.

Later: random faces (morph weights), full outfit editing, all 360 characters.

## 7. The Dummy piece (phase 2, after approval)

- **Build tab:** a Dummy piece with model (player / NPC list), pose, look preset (and the outfit picks above),
  turn, and place, plus "Copy with another look". It needs the game folder connected (`folder.ts`); without one it
  places the stand-in and says so.
- **Data:** `SceneItem.dummy` (recipe) on the render item, `collision_disabled: true`, files `origin: 'game'`. The
  collider is a grouped item from a site recipe.
- **Policy:** `gameObjectPaths`, backups rebuild, the share / gallery / cloud swap to the stand-in, and the hub
  rules' messages.
- **Budget:** a cap of 12 and the look warning in the Check tab.
- **`featureStatus`:** `decoy_dummies` with state `untested`, and a note on what to look for (sections 5 and 6).
  Add a batch item in `testMaps.ts` for `/proven`: three dummies (player standing, player aiming, VK thug crouching)
  by a spawn.
- **Tests:** bake (feet on the ground, facing, triangle counts, winding after the mirror, deterministic PNGs);
  collider boxes per pose; stand-in has no game files; policy, backup and share swaps; cap. With `npm run test:game`,
  bake the default player and one NPC from a local install.
- **Checks before the draft PR:** `npx tsc -b`, `npm run lint`, `npm test`, `npm run test:game`.

## Decisions for the user

1. **Collision:** a body-shaped box set (recommended), one box, or the character's own low-detail mesh.
2. **First-version models:** player decoys only, or player decoys plus the curated NPC list (needs the NPC skin
   shader port and the shared eye and teeth pictures).
3. **Cap:** 12 per map (recommended), or another number.
4. **Poses:** the five hand-set poses, or wait for game animations (an `.anim_xbox2` reader first).
5. **Moving decoys:** a separate companion-mod track later, or not at all.
