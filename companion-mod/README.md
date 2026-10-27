# SR1 Map Studio Companion

A mod for the Saints Reborn mod loader (Whompay's Mod Loader) that makes
testing maps from SR1 Map Studio faster and makes them sound right.

- **Surface sounds.** Without the mod, every custom map plays as concrete:
  footsteps, bullet impacts and their marks are the same on metal pipes, wood,
  grass and glass. SR1 Map Studio already names each texture after its surface,
  but the game reads those names too late to use them. This mod fixes that.
- **Map reload.** In a multiplayer match, press **F7** to load the map again
  from its files. Installing the map again from SR1 Map Studio's **Install to
  game** button reloads it by itself. Edit, install, and you're walking around
  the new version a few seconds later, with no need to restart the game.
- **Playtest log.** Every match you play is recorded to a small file: where
  you went, where you fell, got stuck or the camera was pushed in, and the
  spots you marked with **End**. SR1 Map Studio reads it to show those spots
  on the map.

> **Status: new and not yet tested in game.** If something goes wrong, turn on
> `debug` (see Settings) and look at `mods/wml.log`.

## Install

1. Copy the `companion-mod` folder into `SaintsReborn/dist/mods`, with the
   `playtest` folder in it. You can rename it, for example to
   `SR1MapStudioCompanion`.
2. Run `SaintsReborn/dist/WhompaysModLoader.exe`, tick **SR1 Map Studio
   Companion** and press **Play**.

To remove it, untick it in the mod loader or delete the folder.

## Testing a map with it

1. In SR1 Map Studio, use **Install to game** (or unzip the export into
   `SaintsReborn/dist/maps`) and start the game.
2. Multiplayer > Create Private Party, pick your map and start a match. You can
   play it alone.
3. Change the map in SR1 Map Studio and press **Install to game** again. Within
   about a second the match shows the loading screen and comes back with your
   changes. You can also press **F7** at any time during the match. You come
   back as your own multiplayer character (the look you made for online play).

What still needs a restart of the game:

- a **new** map (a folder that wasn't in `dist/maps` when the game started);
- changes to the map's **name, game modes or ID**. The game reads the list of
  maps once at start-up.

Everything else in the map's folder (geometry, textures, spawns, items,
lights, sky, ambience) is read again when the level loads, so a reload picks
it up.

Reload only the map you play **on your own**. If friends are in the match,
their game doesn't reload with yours.

## Playtest log

While you play a multiplayer match (not the lobby), the mod writes
`playtest/<map>-<date>-<time>.jsonl` in its folder. Each load of the map,
including a reload, starts a new file. Pausing pauses the recording.

Each line is one event, as JSON, with `t` (seconds since the recording
started), `map`, `pos` (x, y, z in game metres) and `heading`:

| `ev` | When | Extra fields |
|---|---|---|
| `start` | The match is in play | `date`, and from the map's `MAP_STUDIO_EXPORT.txt`: `project`, `exported`, `origin`, `world_scale`, `mirror_x`, `floor_y` |
| `pos` | Once a second | |
| `push` | The camera was pushed in by something in the way | `by` (metres), `usual`, `wanted`, `camera` |
| `fall` | A drop of more than 8 m | `drop`, `from_y`, `speed` |
| `fall` | Falling 3 m below the map's lowest floor | `below_floor`, `floor_y`, `from_y` |
| `stuck` | A move key (WASD or the arrows) held for 2 s without getting half a metre | `seconds`, `keys` |
| `mark` | You pressed **End** | `n` |
| `respawn` | You moved more than 15 m in one frame (died, or the match moved you) | `from` |
| `end` | The match ended, the map reloaded or you left | `reason` |

Press **End** wherever something is wrong (a wall you can't see, a gap, a bad
spawn) and SR1 Map Studio shows the spot. The mod only reads the game's
memory; it changes nothing. Turn it off with `playtest_log = false`. Old logs
can be deleted at any time.

Example:

```
{"t":0,"ev":"start","map":"studiotest","pos":[12.5,0.02,-3.1],"heading":1.571,"date":"2026-10-27T18:02:11Z","project":"5d0c…","world_scale":0.5,"mirror_x":true,"floor_y":-0.25}
{"t":1,"ev":"pos","map":"studiotest","pos":[12.9,0.02,-2.4],"heading":1.571}
{"t":6.42,"ev":"mark","map":"studiotest","pos":[18.2,0.02,4.7],"heading":0.8,"n":1}
```

## Surfaces

The surface comes from the last two letters of the texture name, before the
extension: `..._me.tga` is metal, `..._wo.tga` wood. SR1 Map Studio adds them
for you from each material's surface setting. The letters are:

| | | | |
|---|---|---|---|
| `co` Concrete | `cb` Cardboard | `ca` Carpet | `ce` Ceramic |
| `dt` Dirt | `dw` Drywall | `fl` Flesh | `lv` Foliage |
| `gh` Glass Heavy | `gm` Glass Medium | `gl` Glass Light | `gs` Grass |
| `gv` Gravel | `ma` Marble | `fm` Metal Fence | `me` Metal Solid |
| `tm` Metal Thin | `pl` Plastic | `rb` Rubber | `sa` Sand |
| `wa` Water | `wo` Wood | | |

The mod works on every map, including other people's maps that use these
names. Each player hears surfaces only if they have the mod.

## Settings

Edit `mod.ini` in the mod's folder:

| Setting | Default | What it does |
|---|---|---|
| `surface_fix` | `true` | The surface sounds fix. |
| `reload_key` | `F7` | Key that reloads the map (`""` = none). On a Mac keyboard hold Fn for the F-keys. |
| `auto_reload` | `true` | Reload when the map you're playing is installed again. |
| `poll_seconds` | `1.0` | How often to check for a new install. |
| `watch_folder` | `""` | The map's folder in `dist/maps` (for example `Studio Test`), if the mod can't find it by itself. |
| `hud_messages` | `false` | Show "Map reloaded" on the screen. |
| `playtest_log` | `true` | Record each match to `playtest/` (see Playtest log). |
| `debug` | `false` | Write every step to `mods/wml.log`. |

## Troubleshooting

Set `debug = true` in `mod.ini`, play, and open `SaintsReborn/dist/mods/wml.log`:

- `surface: <texture> -> me (15)` means a texture got its surface. No such
  lines means the map's texture names have no surface letters (export it
  again with a recent SR1 Map Studio).
- `auto reload: watching <folder>` shows which folder is watched. If it says
  it can't find the folder, set `watch_folder`.
- `Reloading map ...` then `Map ... reloaded in N s` is a good reload.
  Anything else (`did not start loading`, `ended in state ...`) is worth
  reporting, together with the log.
- `Online look put back (...)` follows every reload. If it says the look
  `differs from before the reload`, or your character doesn't look like
  yours, report it with the log (with `debug = true` it lists the clothes,
  body sliders and colours before and after).

- `Playtest: recording <map> to <file>` starts each recorded match, and
  `Playtest: mark N at [...]` follows each End. `can't write` means the
  mod's folder is read-only.

## Online

Like other script mods, this one makes your game count as modded: use it in a
Private Party, not in public Player or Ranked matches.
