-- SR1 Map Studio Companion - playtest recorder.
--
-- While you play a multiplayer match, this writes what happened to
-- playtest/<map>-<date>-<time>.jsonl in the mod's folder, one JSON object a
-- line, so SR1 Map Studio can show the spots on the map:
--   start   the match's map and, from MAP_STUDIO_EXPORT.txt, the project and
--           how its editor units turn into game metres
--   pos     where you are, once a second
--   push    the camera was pushed in by something in the way
--   fall    a drop of more than 8 m, or falling below the map's lowest floor
--   stuck   hardly moving for 2 s while a move key is held
--   mark    you pressed End (a spot worth a look)
--   respawn you moved more than 15 m in one frame (died, or the match moved you)
--   end     the recording stopped (the match ended or the map reloaded)
-- Every line has t (seconds since the start), map, pos (x, y, z in game
-- metres) and heading. Each load of the map starts a new file; the newest
-- logs are kept (playtest_keep in mod.ini) and older ones deleted.
--
-- Read only: it reads the game's memory and never changes it. The addresses
-- and the camera-push test are the Minimap Probe's: the local player's
-- pointer (0x8309ABEC, position at +20/+24/+28), the minimap heading
-- (0x8370E438) and the camera (0x827D9778: the final camera at +44, after
-- the collision step moved it in). Keys only count while the game window
-- has focus (the mod loader's rule), so typing in another window logs nothing.

local P = {}

local read_u32, read_f32 = wml.read_u32, wml.read_f32

local PLAYER  = 0x8309ABEC
local HEADING = 0x8370E438
local CAM     = 0x827D9778
local STATE_PAUSE = 6

local FALL_METRES     = 8     -- a fall is a drop of more than this ...
local FALL_SPEED      = 8     -- ... that reached this speed (m/s; stairs and ramps don't)
local BELOW_FLOOR     = 3     -- metres under the lowest floor that count as fallen out
local STUCK_SECONDS   = 2
local STUCK_METRES    = 0.5   -- moving less than this in STUCK_SECONDS is stuck
local TELEPORT_METRES = 15
local MOVE_KEYS = { "W", "A", "S", "D", "UP", "DOWN", "LEFT", "RIGHT" }

local reload            -- reload.lua: the match and the map's folder
local log = function() end
local SEP = package.config:sub(1, 1)
local windows = SEP == "\\"
local mod_folder        -- the mod's folder
local keep = 20         -- logs kept (0 = all)
local rec = nil         -- the recording: file, map, trackers
local paused = false    -- the last frame was in the pause menu
local failed = false

local function pointer(v) return v >= 0x40000000 and v < 0xFFFF0000 end

-- ------------------------------------------------------------ the clock
-- Seconds, smooth. os.clock is wall time on Windows. Elsewhere it is CPU
-- time and os.time counts whole seconds, so the frames since os.time last
-- ticked make up the fraction, at the frame rate of the last whole second.
-- When the frame rate rises, the fraction runs out early and the clock
-- stands at .999 until os.time ticks; held counts those frames, so a
-- measurement over a span with one in it can be thrown away.
-- Called once a frame (P.update), paused or not.
local whole, frames_in, fps, held = nil, 0, 60, 0
local function clock()
  if windows then return os.clock() end
  local s = os.time()
  if s ~= whole then
    if whole and s == whole + 1 and frames_in > 0 then fps = frames_in end
    whole, frames_in = s, 0
  end
  frames_in = frames_in + 1
  local fraction = (frames_in - 1) / fps
  if fraction > 0.999 then
    held = held + 1
    return whole + 0.999
  end
  return whole + fraction
end
local now = 0           -- this frame's clock()

-- ------------------------------------------------------------ JSON
local function num(v)
  if v ~= v or v == math.huge or v == -math.huge then return "null" end
  local s = string.format("%.3f", v):gsub("0+$", ""):gsub("%.$", "")
  return s == "-0" and "0" or s
end

local function str(s)
  return '"' .. tostring(s):gsub('[%c"\\]', function(c)
    if c == '"' or c == "\\" then return "\\" .. c end
    return string.format("\\u%04x", c:byte())
  end) .. '"'
end

local function vec(v) return "[" .. num(v[1]) .. "," .. num(v[2]) .. "," .. num(v[3]) .. "]" end

-- One value: numbers, strings, booleans, {x, y, z} positions.
local function value(v)
  local kind = type(v)
  if kind == "number" then return num(v) end
  if kind == "boolean" then return tostring(v) end
  if kind == "table" then return vec(v) end
  return str(v)
end

-- fields: name, value pairs (in order, so the lines read well); a nil value is left out.
local function write(ev, pos, fields)
  local parts = { '"t":' .. num(now - rec.started), '"ev":' .. str(ev), '"map":' .. str(rec.map),
    '"pos":' .. vec(pos), '"heading":' .. num(read_f32(HEADING)) }
  fields = fields or {}
  local i = 1
  while fields[i] do
    if fields[i + 1] ~= nil then parts[#parts + 1] = str(fields[i]) .. ":" .. value(fields[i + 1]) end
    i = i + 2
  end
  rec.file:write("{" .. table.concat(parts, ",") .. "}\n")
  rec.file:flush()
end

-- ------------------------------------------------------------ the export note
-- MAP_STUDIO_EXPORT.txt in the map's folder: the project, and the frame that
-- turns editor units into game metres (exportFactLines in lib/playtest.ts
-- writes these lines; tests/playtestLua.test.ts reads them back through here).
local function export_note(map)
  local dir = reload.folder(map)
  local text = dir and reload.read_file(reload.join(dir, "MAP_STUDIO_EXPORT.txt"))
  if not text then return {} end
  -- Each field starts a line, as readExportNote has it.
  text = "\n" .. text
  local function field(pattern) return text:match("\n" .. pattern) end
  local note = {}
  note.exported = field("Exported by [^\r\n]- on (%S+)")
  note.project = field("Project id: *([%w%-_]+)")
  local ox, oy, oz = field("Map origin: *(%S+) +(%S+) +(%S+)")
  if ox then note.origin = { tonumber(ox), tonumber(oy), tonumber(oz) } end
  note.world_scale = tonumber(field("World scale: *(%S+)") or "")
  local mirror = field("Mirror X: *(%a+)")
  if mirror then note.mirror_x = mirror == "on" end
  note.floor_y = tonumber(field("Lowest floor: *(%S+)") or "")
  return note
end

-- ------------------------------------------------------------ log files
local function exists(path)
  local f = io.open(path, "r")
  if f then f:close() end
  return f ~= nil
end

-- A new file in dir: <map>-<date>-<time>.jsonl, with -2, -3 ... when a log
-- from the same second is already there (leaving and coming back quickly).
local function new_log(dir, map)
  local base = map:gsub("[^%w_%-]", "_") .. "-" .. os.date("%Y%m%d-%H%M%S")
  for n = 1, 99 do
    local name = base .. (n > 1 and "-" .. n or "") .. ".jsonl"
    if not exists(dir .. SEP .. name) then
      local file = io.open(dir .. SEP .. name, "w")
      return file, name
    end
  end
end

-- Keeps the newest `keep` logs: index.txt beside them lists the ones this
-- mod wrote, oldest first (Lua can't list a folder), and the oldest go.
-- name, the log just opened, is the newest wherever else the index has it,
-- so it is never the one deleted.
local function remember(dir, name)
  local index = dir .. SEP .. (dir == mod_folder and "playtest-index.txt" or "index.txt")
  local list, seen = {}, { [name] = true }
  local f = io.open(index, "r")
  if f then
    for line in f:lines() do
      -- Only plain log names, each once: the index can't point anywhere else.
      if line:match("^[%w_%-]+%.jsonl$") and not seen[line] then
        seen[line] = true
        list[#list + 1] = line
      end
    end
    f:close()
  end
  list[#list + 1] = name
  while keep > 0 and #list > keep do
    local old = table.remove(list, 1)
    if os.remove(dir .. SEP .. old) then log("Playtest: deleted old log " .. old) end
  end
  f = io.open(index, "w")
  if f then
    f:write(table.concat(list, "\n"), "\n")
    f:close()
  end
end

-- ------------------------------------------------------------ the recording
local function player_pos()
  local player = read_u32(PLAYER)
  if not pointer(player) then return nil end
  return { read_f32(player + 20), read_f32(player + 24), read_f32(player + 28) }
end

local function open(map, pos)
  local dir = mod_folder .. SEP .. "playtest"
  local file, name = new_log(dir, map)
  if not file then
    -- The playtest folder is missing (the mod was copied without it): the mod's own folder then.
    dir = mod_folder
    file, name = new_log(dir, "playtest-" .. map)
  end
  if not file then
    wml.log("Playtest: can't write a log in " .. mod_folder .. "; recording off")
    failed = true
    return
  end
  remember(dir, name)
  local t = now
  local note = export_note(map)
  rec = { file = file, map = map, started = t, note = note, last = pos, next_pos = t, prev_t = t,
    top = pos[2], low = pos[2], low_at = t, v_at = t, v_y = pos[2], v_held = held, fall_speed = 0, below = false,
    anchor = pos, anchor_at = t, stuck = false, usual = 0, frames = 0, last_push = -100, push_at = -100, marks = 0 }
  write("start", pos, { "date", os.date("!%Y-%m-%dT%H:%M:%SZ"), "project", note.project, "exported", note.exported,
    "origin", note.origin, "world_scale", note.world_scale, "mirror_x", note.mirror_x, "floor_y", note.floor_y })
  wml.log("Playtest: recording " .. map .. " to " .. dir .. SEP .. name)
end

local function close(why)
  if not rec then return end
  write("end", rec.last, { "reason", why })
  rec.file:close()
  log("Playtest: stopped (" .. why .. "), " .. string.format("%.0f s", now - rec.started))
  rec = nil
end

local function dist(a, b, flat)
  local dy = flat and 0 or a[2] - b[2]
  return math.sqrt((a[1] - b[1]) ^ 2 + dy ^ 2 + (a[3] - b[3]) ^ 2)
end

-- Falls: the highest point since the player last stood still in height, the
-- fastest drop since then (over 0.1 s windows, leaving out any the clock
-- stood still in: they lasted longer than they say), and a landing once the
-- height has stopped going down for 0.3 s.
local function falls(t, pos)
  local y = pos[2]
  if y > rec.top then rec.top = y end
  if t - rec.v_at >= 0.1 then
    if held == rec.v_held then rec.fall_speed = math.max(rec.fall_speed, (rec.v_y - y) / (t - rec.v_at)) end
    rec.v_at, rec.v_y, rec.v_held = t, y, held
  end
  if y < rec.low - 0.05 then
    rec.low, rec.low_at = y, t
  elseif t - rec.low_at > 0.3 then
    local drop = rec.top - y
    if drop > FALL_METRES and rec.fall_speed > FALL_SPEED then
      write("fall", pos, { "drop", drop, "from_y", rec.top, "speed", rec.fall_speed })
      log(string.format("Playtest: fell %.1f m", drop))
    end
    rec.top, rec.low, rec.low_at, rec.fall_speed = y, y, t, 0
  end
  local floor = rec.note.floor_y
  if floor and not rec.below and y < floor - BELOW_FLOOR then
    rec.below = true
    write("fall", pos, { "below_floor", true, "floor_y", floor, "from_y", rec.top })
    log("Playtest: fell below the map's lowest floor")
  elseif floor and y > floor then
    rec.below = false
  end
end

local function keys_held()
  local held = {}
  for _, k in ipairs(MOVE_KEYS) do
    if wml.key_down(k) then held[#held + 1] = k end
  end
  return table.concat(held, "+")
end

-- Stuck: a move key held for 2 s without getting half a metre from where it started.
local function stuck(t, pos)
  local keys = keys_held()
  if keys == "" or dist(pos, rec.anchor, true) > STUCK_METRES then
    if keys == "" or dist(pos, rec.anchor, true) > 1 then rec.stuck = false end
    rec.anchor, rec.anchor_at = pos, t
    return
  end
  if not rec.stuck and t - rec.anchor_at >= STUCK_SECONDS then
    rec.stuck = true
    write("stuck", pos, { "seconds", t - rec.anchor_at, "keys", keys })
    log("Playtest: stuck at " .. vec(pos))
  end
end

-- The Minimap Probe's test: the final camera much nearer the player's head
-- than usual (a slow running maximum) means something pushed it in.
local function camera_push(t, pos)
  rec.frames = rec.frames + 1
  local fx, fy, fz = read_f32(CAM + 44), read_f32(CAM + 48), read_f32(CAM + 52)
  local hx, hy, hz = pos[1], pos[2] + 1.5, pos[3]
  local d = math.sqrt((fx - hx) ^ 2 + (fy - hy) ^ 2 + (fz - hz) ^ 2)
  if d ~= d or d > 20 then return end
  rec.usual = math.max(d, rec.usual * 0.999)
  if rec.usual < 1 or d > rec.usual * 0.75 or rec.frames - rec.last_push < 10 then return end
  rec.last_push = rec.frames
  -- At most two lines a second for one long push.
  if t - rec.push_at < 0.5 then return end
  rec.push_at = t
  local k = rec.usual / math.max(d, 0.01)
  write("push", pos, { "by", rec.usual - d, "usual", rec.usual,
    "wanted", { hx + (fx - hx) * k, hy + (fy - hy) * k, hz + (fz - hz) * k }, "camera", { fx, fy, fz } })
end

local function record(t, pos)
  -- Back from the pause menu, or a long hitch: time went on without the player.
  if paused or t - rec.prev_t > 1.5 then rec.anchor_at, rec.low_at, rec.v_at, rec.v_y, rec.v_held = t, t, t, pos[2], held end
  rec.prev_t = t
  if dist(pos, rec.last) > TELEPORT_METRES then
    write("respawn", pos, { "from", rec.last })
    rec.top, rec.low, rec.low_at, rec.v_at, rec.v_y, rec.v_held, rec.fall_speed = pos[2], pos[2], t, t, pos[2], held, 0
    rec.anchor, rec.anchor_at, rec.stuck, rec.below = pos, t, false, false
  else
    falls(t, pos)
    stuck(t, pos)
    camera_push(t, pos)
  end
  rec.last = pos
  if wml.key_pressed("END") then
    rec.marks = rec.marks + 1
    write("mark", pos, { "n", rec.marks })
    wml.log("Playtest: mark " .. rec.marks .. " at " .. vec(pos))
  end
  if t >= rec.next_pos then
    rec.next_pos = rec.next_pos + 1
    if rec.next_pos < t then rec.next_pos = t + 1 end
    write("pos", pos)
  end
end

function P.setup(reload_module, debug, settings)
  reload = reload_module
  if debug then log = wml.log end
  keep = math.max(0, math.floor(tonumber((settings or {}).keep) or 20))
  mod_folder = wml.mod_folder
  if not mod_folder or mod_folder == "" then
    wml.log("Playtest: the mod loader didn't say where the mod's folder is; recording off")
    failed = true
    return
  end
  -- Key watches start before the first frame.
  for _, k in ipairs(MOVE_KEYS) do wml.key_down(k) end
  wml.key_down("END")
  log("Playtest: logs go to " .. mod_folder .. SEP .. "playtest, the newest " .. (keep > 0 and keep or "all") .. " kept")
end

-- Every frame: records while a multiplayer match is in play, pauses with the
-- pause menu, and closes the file when the match ends or the map reloads.
function P.update()
  if failed then return end
  local ok, err = pcall(function()
    now = clock()
    local playing, map = reload.match()
    if not playing then
      if rec and reload.state() ~= STATE_PAUSE then close("left play") end
      paused = rec ~= nil
      return
    end
    if rec and rec.map ~= map then close("new map") end
    local pos = player_pos()
    if not pos then return end
    if not rec then open(map, pos) end
    if rec then record(now, pos) end
    paused = false
  end)
  if not ok then
    failed = true
    wml.log("Playtest: recording stopped by an error: " .. tostring(err))
    if rec then pcall(rec.file.close, rec.file) end
    rec = nil
  end
end

return P
