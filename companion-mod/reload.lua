-- SR1 Map Studio Companion - reload the multiplayer map you're playing.
--
-- A match reads its map files from dist/maps/<folder>/levels every time the
-- level loads, so a map that was installed again only needs its level loaded
-- again. This asks the game to load the current match level once more, the
-- same way a match start does: the level request (0x8220CA90) gets the match's
-- map, CTS, Lua and PEG names, then the game switches to its level-load state
-- (7, via 0x82209C58), which loads the level and goes back to play (5).
--
-- With auto reload on, it watches the map's folder: SR1 Map Studio writes
-- MAP_STUDIO_EXPORT.txt last on every install, with the export time in it,
-- so a changed file means a complete new export.
--
-- What it can't do: a map folder that is new since the game started, or a
-- changed level list (name, modes, ID), needs a restart, because the game
-- mounts map folders and reads their level lists once at start-up.

local R = {}

local read_u8, read_u32 = wml.read_u8, wml.read_u32

local STATE_INDEX, STATE_STACK = 0x827D5780, 0x82B30E78  -- current state = stack[index]
local STATE_FRONT_END, STATE_GAME, STATE_PAUSE, STATE_LOAD = 2, 5, 6, 7
local MULTIPLAYER   = 0x8370E9F6  -- byte: a multiplayer session is active
local LEVEL         = 0x830784F0  -- the match level's names, 64 bytes each: PEG, Lua +64, CTS +128, map +192
local REQUEST       = 0x838FAB00  -- the level-load request: map +0, Lua +65, CTS +130, PEG +195
local FILL_REQUEST  = 0x8220CA90  -- (map, cts, lua, peg, flag)
local REQUEST_STATE = 0x82209C58  -- (state, force)
local HUD_MESSAGE   = 0x82367568  -- (UTF-16 text, f1 = seconds)
local LOBBY_LEVEL   = "mplobby_01"

local cfg = {}
local log = function() end

local SEP = package.config:sub(1, 1)
local windows = SEP == "\\"
-- Seconds. os.clock is wall time on Windows; elsewhere it is CPU time.
local function now() return windows and os.clock() or os.time() end

local function game_state()
  local index = read_u32(STATE_INDEX)
  if index >= 0x80000000 then return 0 end
  return read_u32(STATE_STACK + 4 * index)
end

local function cstr(addr, max)
  local t = {}
  for i = 0, max - 1 do
    local b = read_u8(addr + i)
    if b == 0 then break end
    t[#t + 1] = string.char(b)
  end
  return table.concat(t)
end

-- "srbundle6:\levels\studiotest" or "studiotest" -> "studiotest".
local function base_name(s) return (s:match("([^\\/:]+)$") or s):lower() end

local function current_map()
  local map = cstr(LEVEL + 192, 64)
  if map == "" then map = cstr(REQUEST, 65) end
  return base_name(map)
end

-- ------------------------------------------------------------ calling the game
-- From inside the update hook, with its own CPU context (see the SR Tweak Menu's
-- game.lua): r1 lowered to leave the callee stack room, arguments in r3..,
-- registers put back afterwards.
local SCRATCH = 0x6000

local function call(ctx, fn, args, f1)
  local r1 = ctx:r(1)
  local saved = {}
  for i = 3, 10 do saved[i] = ctx:r(i) end
  local saved_f1 = ctx:f(1)
  for i, v in ipairs(args) do ctx:set_r(2 + i, v & 0xFFFFFFFF) end
  if f1 then ctx:set_f(1, f1) end
  ctx:set_r(1, r1 - SCRATCH)
  ctx:call(fn)
  local r3 = ctx:r(3) & 0xFFFFFFFF
  ctx:set_r(1, r1)
  for i = 3, 10 do ctx:set_r(i, saved[i]) end
  ctx:set_f(1, saved_f1)
  return r3
end

local function hud(ctx, text)
  if not cfg.hud then return end
  -- A UTF-16 copy of the text in the gap below the hook's r1.
  local buf = ctx:r(1) - 0x1000
  for i = 1, #text do wml.write_u16(buf + (i - 1) * 2, string.byte(text, i)) end
  wml.write_u16(buf + #text * 2, 0)
  call(ctx, HUD_MESSAGE, { buf }, 3.0)
end

-- ------------------------------------------------------------ files
local function parent(path)
  return (path:gsub("[/\\]+$", "")):match("^(.*)[/\\][^/\\]*$")
end

local function join(a, b) return a .. SEP .. b end

local function read_file(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local data = f:read("a")
  f:close()
  return data
end

local function file_size(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local size = f:seek("end")
  f:close()
  return size
end

local dist_folder = parent(parent(wml.mod_folder or "") or "") or ""
local maps_folder = join(dist_folder, "maps")

-- The map folders the game mounted, from its log (dist/saintsrow_sdk.log):
-- "Map packs: <folder> mounted as srbundle<N>:".
local function mounted_folders()
  local found, seen = {}, {}
  for _, name in ipairs({ "saintsrow_sdk.log", "saintsrow_sdk.1.log" }) do
    local text = read_file(join(dist_folder, name))
    if text then
      for path in text:gmatch("Map packs: ([^\r\n]-) mounted as srbundle%d+:") do
        if not seen[path] then seen[path] = true; found[#found + 1] = path end
      end
    end
    if #found > 0 then break end
  end
  return found
end

local function has_map(folder, map)
  local xtbl = read_file(join(join(folder, "levels"), "multiplayer_levels_extra.xtbl"))
  return xtbl ~= nil and xtbl:lower():find("<map>%s*" .. map:gsub("%p", "%%%0") .. "%s*</map>") ~= nil
end

-- The folder in dist/maps that holds `map`, or nil.
local folder_of = {}
local function find_folder(map)
  if folder_of[map] ~= nil then return folder_of[map] or nil end
  local result = false
  if cfg.watch_folder ~= "" then
    local f = cfg.watch_folder
    if not f:find("[/\\]") then f = join(maps_folder, f) end
    -- Only for the map that folder holds, not every map played.
    if has_map(f, map) then result = f end
  else
    local candidates = mounted_folders()
    if #candidates == 0 then
      log("auto reload: no map folders in the game log; trying dist/maps/" .. map)
      candidates = { join(maps_folder, map) }
    end
    -- Prefer an SR1 Map Studio export when two folders hold the same map.
    for _, f in ipairs(candidates) do
      if has_map(f, map) and (not result or read_file(join(f, "MAP_STUDIO_EXPORT.txt"))) then
        result = f
      end
    end
  end
  folder_of[map] = result
  if result then
    log("auto reload: " .. map .. " is in " .. result)
  else
    wml.log("auto reload: no folder in dist/maps holds map " .. map ..
      " (a disc map, or set watch_folder in mod.ini); the reload key still works")
  end
  return result or nil
end

-- What changes when the map is installed again: the export note's text (it
-- holds the export time), else the sizes of the map's level files.
local function signature(folder, map)
  local note = read_file(join(folder, "MAP_STUDIO_EXPORT.txt"))
  if note then return note end
  local levels = join(folder, "levels")
  local a = file_size(join(levels, map .. ".bbchunk_xbox2"))
  local b = file_size(join(levels, map .. ".peg_xbox2"))
  if not a and not b then return nil end
  return tostring(a) .. "/" .. tostring(b)
end

-- ------------------------------------------------------------ reloading
local watched = { map = nil, folder = nil, sig = nil, next_check = 0 }
local reloading = nil  -- { map, started, saw_load }

local function in_match()
  if read_u8(MULTIPLAYER) == 0 or game_state() ~= STATE_GAME then return false end
  local map = current_map()
  return map ~= "" and map ~= LOBBY_LEVEL, map
end

local function reload(ctx, map, why)
  local peg, lua, cts = cstr(LEVEL, 64), cstr(LEVEL + 64, 64), cstr(LEVEL + 128, 64)
  log(string.format("reload (%s): map %s, cts %s, lua %s, peg %s; request now map %s",
    why, cstr(LEVEL + 192, 64), cts, lua, peg, cstr(REQUEST, 65)))
  if cstr(LEVEL + 192, 64) ~= "" then
    -- The match setup's own call, with the match level's names.
    call(ctx, FILL_REQUEST, { LEVEL + 192, LEVEL + 128, LEVEL + 64, LEVEL, 1 })
  end
  log(string.format("reload: request map %s, lua %s, cts %s, peg %s",
    cstr(REQUEST, 65), cstr(REQUEST + 65, 65), cstr(REQUEST + 130, 65), cstr(REQUEST + 195, 65)))
  call(ctx, REQUEST_STATE, { STATE_LOAD, 0 })
  reloading = { map = map, started = now(), saw_load = false }
  wml.log("Reloading map " .. map .. " (" .. why .. ")")
end

-- Follows a reload until the game is back in play (or not).
local function follow(ctx)
  local state = game_state()
  if state == STATE_LOAD then reloading.saw_load = true end
  local seconds = now() - reloading.started
  if reloading.saw_load and state == STATE_GAME then
    wml.log(string.format("Map %s reloaded in %.1f s", reloading.map, seconds))
    hud(ctx, "Map reloaded")
    -- The files as loaded are the new baseline.
    if watched.folder then watched.sig = signature(watched.folder, watched.map) end
    reloading = nil
  elseif state == STATE_FRONT_END or seconds > 120 then
    wml.log(string.format("Reload of %s ended in state %d after %.1f s", reloading.map, state, seconds))
    reloading = nil
  elseif not reloading.saw_load and seconds > 5 then
    wml.log("Reload of " .. reloading.map .. ": the game did not start loading (state " .. state .. ")")
    reloading = nil
  end
end

local function watch(ctx, map)
  local t = now()
  if t < watched.next_check then return end
  watched.next_check = t + cfg.poll_seconds
  if watched.map ~= map then
    watched.map, watched.folder = map, find_folder(map)
    watched.sig = watched.folder and signature(watched.folder, map) or nil
    if watched.folder then log("auto reload: watching " .. watched.folder) end
    return
  end
  if not watched.folder then return end
  local sig = signature(watched.folder, map)
  if sig and sig ~= watched.sig then
    watched.sig = sig
    reload(ctx, map, "new export in " .. watched.folder)
  end
end

function R.setup(settings, debug)
  cfg = settings
  if debug then log = wml.log end
  log("reload: dist folder " .. dist_folder .. ", key " .. (cfg.key ~= "" and cfg.key or "none") ..
    ", auto reload " .. tostring(cfg.auto))
end

-- Runs in the update hook, after the game's own update.
function R.update(ctx)
  if reloading then follow(ctx) return end
  -- Anything but play or the pause menu (a load, the lobby, the front end)
  -- means the next match reads the files fresh: start watching again then.
  local state = game_state()
  if state ~= STATE_GAME and state ~= STATE_PAUSE then watched.map = nil end
  local ok, map = in_match()
  if cfg.key ~= "" and wml.key_pressed(cfg.key) then
    if ok then
      reload(ctx, map, cfg.key)
      return
    end
    wml.log(string.format("Reload key: not in a multiplayer match (state %d, multiplayer %d, level %s)",
      game_state(), read_u8(MULTIPLAYER), current_map()))
  end
  if ok and cfg.auto then watch(ctx, map) end
end

return R
