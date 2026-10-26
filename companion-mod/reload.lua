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
--
-- The player's online look: a match load dresses the local player from the
-- online customization profile (0x83A22500: body preset, sliders, clothes,
-- tattoos, colours) in the level's post-init, but only while the game mode
-- (0x827D578C, or the next mode at 0x827D5790) is a multiplayer one (6 or
-- more). Leaving play for the level load unloads the level, which sets the
-- mode to 4 and the next mode to -1, so the post-init then gives the player
-- the single-player default look. So once the reloaded level is in play,
-- this takes everything off (0x82318B38, as the game does before it dresses
-- the player) and applies the profile with the post-init's own call
-- (0x8236D720(0, 0)), then checks the look against the one from before.

local R = {}

local read_u8, read_u16, read_u32, read_f32 = wml.read_u8, wml.read_u16, wml.read_u32, wml.read_f32

local STATE_INDEX, STATE_STACK = 0x827D5780, 0x82B30E78  -- current state = stack[index]
local STATE_FRONT_END, STATE_GAME, STATE_PAUSE, STATE_LOAD = 2, 5, 6, 7
local MULTIPLAYER   = 0x8370E9F6  -- byte: a multiplayer session is active
local LEVEL         = 0x830784F0  -- the match level's names, 64 bytes each: PEG, Lua +64, CTS +128, map +192
local REQUEST       = 0x838FAB00  -- the level-load request: map +0, Lua +65, CTS +130, PEG +195
local FILL_REQUEST  = 0x8220CA90  -- (map, cts, lua, peg, flag)
local REQUEST_STATE = 0x82209C58  -- (state, force)
local HUD_MESSAGE   = 0x82367568  -- (UTF-16 text, f1 = seconds)
local LOBBY_LEVEL   = "mplobby_01"

-- The look (see the top of the file).
local PLAYER        = 0x8309ABEC  -- pointer to the local player
local CUSTOM, VOICE = 4484, 3552  -- player+: customization record, voice (set from the body preset)
local SLOT_TABLES   = 0x83036140  -- per record slot (record +8): clothes worn, count +13056 + slot*4, items +13120 + slot*1080, 20 B each
local COLOURS       = 0x8304D160  -- per slot: colour choices, count + slot*4, {?, key, option} at +48 + slot*60, 12 B each
local PROFILE       = 0x83A22500  -- the online customization profile
local PROFILE_READ  = 0x8370F210  -- byte: the profile was read
local MODE, NEXT_MODE = 0x827D578C, 0x827D5790
local TAKE_OFF_ALL  = 0x82318B38  -- (record)
local APPLY_PROFILE = 0x8236D720  -- (clear the changed flag, stream in the background)

local cfg = {}
local log = function() end
local debug_on = false

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

-- ------------------------------------------------------------ the player's look
local function s32(v) return v >= 0x80000000 and v - 0x100000000 or v end
local function pointer(v) return v >= 0x40000000 and v < 0xFFFF0000 end

local function modes()
  return string.format("mode %d, next mode %d", s32(read_u32(MODE)), s32(read_u32(NEXT_MODE)))
end

local function profile_info()
  return string.format("profile read %d, version %d, preset %d, %d sliders, %d clothes, %d tattoos, %d colour bytes",
    read_u8(PROFILE_READ), read_u16(PROFILE), s32(read_u32(PROFILE + 12)), s32(read_u32(PROFILE + 16)),
    s32(read_u32(PROFILE + 1044)), s32(read_u32(PROFILE + 3096)), s32(read_u32(PROFILE + 27716)))
end

-- What the local player looks like now: clothes, sliders (the wanted value
-- of the record's 128 entries of 12 bytes at *(record+4)), colours, voice.
local function look()
  local player = read_u32(PLAYER)
  if not pointer(player) then return nil end
  local t = { player = player, custom = read_u32(player + CUSTOM), slot = -1,
    voice = read_u32(player + VOICE), worn = {}, sliders = {}, colours = {} }
  if not pointer(t.custom) then t.custom = nil return t end
  t.slot = read_u32(t.custom + 8)
  if t.slot < 12 then
    local worn = math.min(read_u32(SLOT_TABLES + 13056 + t.slot * 4), 54)
    for i = 0, worn - 1 do
      t.worn[#t.worn + 1] = read_u32(SLOT_TABLES + 13120 + t.slot * 1080 + i * 20)
    end
    table.sort(t.worn)
    local colours = math.min(read_u32(COLOURS + t.slot * 4), 5)
    for i = 0, colours - 1 do
      local entry = COLOURS + 48 + t.slot * 60 + i * 12
      t.colours[#t.colours + 1] = string.format("%X:%X", read_u32(entry + 4), read_u32(entry + 8))
    end
    table.sort(t.colours)
  end
  local sliders = read_u32(t.custom + 4)
  if pointer(sliders) then
    for i = 0, 127 do t.sliders[i + 1] = read_f32(sliders + i * 12 + 4) end
  end
  return t
end

local function describe(t)
  if not t then return "no player" end
  if not t.custom then return string.format("player %08X has no customization record", t.player) end
  local items = {}
  for i, v in ipairs(t.worn) do items[i] = string.format("%08X", v) end
  local off = 0
  for _, v in ipairs(t.sliders) do
    if math.abs(v - 0.5) > 0.001 then off = off + 1 end
  end
  return string.format("player %08X, record %08X slot %d, voice %08X, %d clothes [%s], %d sliders (%d off the middle), colours [%s]",
    t.player, t.custom, t.slot, t.voice, #t.worn, table.concat(items, " "), #t.sliders, off, table.concat(t.colours, " "))
end

local function same_list(a, b)
  if #a ~= #b then return false end
  for i = 1, #a do
    if a[i] ~= b[i] then return false end
  end
  return true
end

-- Whether two looks are the same, and a line saying what differs.
local function compare(a, b)
  if not (a and a.custom and b and b.custom) then return false, "no look to compare" end
  local clothes, colours, voice = same_list(a.worn, b.worn), same_list(a.colours, b.colours), a.voice == b.voice
  local sliders = 0
  for i, v in ipairs(a.sliders) do
    if b.sliders[i] and math.abs(v - b.sliders[i]) < 0.001 then sliders = sliders + 1 end
  end
  local all_sliders = #a.sliders == #b.sliders and sliders == #a.sliders
  local word = function(ok) return ok and "same" or "DIFFERENT" end
  return clothes and colours and voice and all_sliders,
    string.format("clothes %s (%d, was %d), sliders %d of %d the same, colours %s, voice %s",
      word(clothes), #b.worn, #a.worn, sliders, #a.sliders, word(colours), word(voice))
end

-- Dresses the local player from the online profile, the way the post-init of
-- a match load does. Returns the look after it.
local function apply_online_look(ctx)
  local now_look = look()
  if not (now_look and now_look.custom) then
    wml.log("Reload: no local player to dress (" .. describe(now_look) .. ")")
    return now_look
  end
  log("look: " .. profile_info() .. "; " .. modes())
  if now_look.slot < 12 then
    call(ctx, TAKE_OFF_ALL, { now_look.custom })
  else
    log(string.format("look: record slot %d, nothing taken off", now_look.slot))
  end
  call(ctx, APPLY_PROFILE, { 0, 0 })
  return look()
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
local reloading = nil  -- { map, started, saw_load, state, look }
local recheck = nil    -- debug: { at, look } to look at the player again a little later

local function in_match()
  if read_u8(MULTIPLAYER) == 0 or game_state() ~= STATE_GAME then return false end
  local map = current_map()
  -- The lobby's level is "mplobby_01.bbcity_xbox2".
  return map ~= "" and map:match("^[^.]*") ~= LOBBY_LEVEL, map
end

local function reload(ctx, map, why)
  local peg, lua, cts = cstr(LEVEL, 64), cstr(LEVEL + 64, 64), cstr(LEVEL + 128, 64)
  log(string.format("reload (%s): map %s, cts %s, lua %s, peg %s; request now map %s",
    why, cstr(LEVEL + 192, 64), cts, lua, peg, cstr(REQUEST, 65)))
  -- The look to come back with.
  local before = look()
  log("reload: look before: " .. describe(before))
  log("reload: " .. profile_info() .. "; " .. modes())
  if cstr(LEVEL + 192, 64) ~= "" then
    -- The match setup's own call, with the match level's names.
    call(ctx, FILL_REQUEST, { LEVEL + 192, LEVEL + 128, LEVEL + 64, LEVEL, 1 })
  end
  log(string.format("reload: request map %s, lua %s, cts %s, peg %s",
    cstr(REQUEST, 65), cstr(REQUEST + 65, 65), cstr(REQUEST + 130, 65), cstr(REQUEST + 195, 65)))
  call(ctx, REQUEST_STATE, { STATE_LOAD, 0 })
  reloading = { map = map, started = now(), saw_load = false, state = game_state(), look = before }
  recheck = nil
  wml.log("Reloading map " .. map .. " (" .. why .. ")")
end

-- Puts the online look back after the load and says how it went.
local function restore_look(ctx)
  local before = reloading.look
  local loaded = look()
  local same, detail = compare(before, loaded)
  log("look: after the load: " .. describe(loaded))
  log("look: after the load against before: " .. detail)
  local after = apply_online_look(ctx)
  same, detail = compare(before, after)
  log("look: after dressing: " .. describe(after))
  if same then
    wml.log("Online look put back (" .. detail .. ")")
  else
    wml.log("Online look put back, but it differs from before the reload: " .. detail)
  end
  if debug_on then recheck = { at = now() + 2, look = before } end
end

-- Follows a reload until the game is back in play (or not).
local function follow(ctx)
  local state = game_state()
  if state ~= reloading.state then
    log(string.format("reload: state %d -> %d after %.2f s; %s", reloading.state, state,
      now() - reloading.started, modes()))
    reloading.state = state
  end
  if state == STATE_LOAD then reloading.saw_load = true end
  local seconds = now() - reloading.started
  if reloading.saw_load and state == STATE_GAME then
    wml.log(string.format("Map %s reloaded in %.1f s", reloading.map, seconds))
    restore_look(ctx)
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
  debug_on = debug == true
  log("reload: dist folder " .. dist_folder .. ", key " .. (cfg.key ~= "" and cfg.key or "none") ..
    ", auto reload " .. tostring(cfg.auto))
end

-- Runs in the update hook, after the game's own update.
function R.update(ctx)
  if reloading then follow(ctx) return end
  if recheck and now() >= recheck.at then
    -- Debug: whether anything changed the look in the first seconds of play.
    local _, detail = compare(recheck.look, look())
    log("look: 2 s later against before the reload: " .. detail)
    recheck = nil
  end
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
