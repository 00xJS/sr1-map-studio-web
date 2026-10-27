-- Runs companion-mod/playtest.lua against fake game memory, for tests/playtestLua.test.ts (in fengari, a Lua VM in
-- JavaScript). In: PLAYTEST_SRC (the recorder), NOTE (MAP_STUDIO_EXPORT.txt, or nil), MOD_FOLDER (nil = the mod
-- loader didn't say), SCENARIO ("rooftop" or "reenter"), KEEP, INDEX (an index.txt already there, or nil).
-- Out: RESULT, the files written ("### <path>" before each), and LOG, the wml.log lines.

local T = 0
local U32, F32 = {}, {}
local down, pressed = {}, {}
local playing, state = true, 5
local logs, files, order = {}, {}, {}

wml = { mod_folder = MOD_FOLDER }
function wml.read_u32(a) return U32[a] or 0 end
function wml.read_f32(a) return F32[a] or 0 end
function wml.key_down(k) return down[k] == true end
function wml.key_pressed(k) return pressed[k] == true end
function wml.log(s) logs[#logs + 1] = s end

-- The clock: T, in whole seconds for os.time (as on a Mac); the date is fixed, so two logs share a name.
os.clock = function() return T end
os.time = function() return math.floor(T) end
os.date = function(f) return f:sub(1, 1) == "!" and "2026-10-27T18:02:11Z" or "20261027-180211" end
os.remove = function(p)
  if not files[p] then return nil end
  files[p] = nil
  logs[#logs + 1] = "(removed " .. p .. ")"
  return true
end
io.open = function(path, mode)
  if mode == "r" then
    local f = files[path]
    if not f then return nil end
    local text = table.concat(f)
    return { close = function() end, lines = function() return text:gmatch("[^\n]+") end }
  end
  local buf = {}
  if not files[path] then order[#order + 1] = path end
  files[path] = buf
  return { write = function(_, ...) for _, s in ipairs({ ... }) do buf[#buf + 1] = s end end,
    flush = function() end, close = function() end }
end

local SEP = package.config:sub(1, 1)
if INDEX and MOD_FOLDER then
  local index = MOD_FOLDER .. SEP .. "playtest" .. SEP .. "index.txt"
  files[index], order[#order + 1] = { INDEX }, index
  for name in INDEX:gmatch("[^\n]+") do
    local p = MOD_FOLDER .. SEP .. "playtest" .. SEP .. name
    files[p], order[#order + 1] = { "old\n" }, p
  end
end

local reload = {
  state = function() return state end,
  match = function() return playing, "rooftop" end,
  folder = function() return "C:/Games/SaintsReborn/dist/maps/Rooftop test" end,
  read_file = function(p) return p:match("MAP_STUDIO_EXPORT%.txt$") and NOTE or nil end,
  join = function(a, b) return a .. "/" .. b end,
}
local P = assert(load(PLAYTEST_SRC, "=playtest.lua"))()
P.setup(reload, true, { keep = KEEP })

local PLAYER, HEADING, CAM = 0x8309ABEC, 0x8370E438, 0x827D9778
U32[PLAYER] = 0x44001000
local x, y, z, vy, heading = -20, 12, 6, 0, 1.571
local cam_dist = 4
local function frame()
  F32[0x44001000 + 20], F32[0x44001000 + 24], F32[0x44001000 + 28] = x, y, z
  F32[HEADING] = heading
  -- The camera behind the player (along -x), above the head.
  F32[CAM + 44], F32[CAM + 48], F32[CAM + 52] = x - cam_dist * 0.9, y + 1.5 + cam_dist * 0.43, z
  P.update()
end

local dt = 1 / 60
if SCENARIO == "rooftop" then
  -- Run on a roof (y 12), pressed against a wall, End, off the edge to the street, past a pillar, down a ramp to
  -- an underpass, through a gap, respawn, the pause menu, End again, match over.
  local wobble = 0
  for f = 0, 60 * 26 do
    T = f * dt
    down, pressed = {}, {}
    cam_dist = 4
    if T < 3 then down.W = true; x = x + 5 * dt
    elseif T < 5.3 then down.W = true; wobble = -wobble + 0.001; x = x + wobble
    elseif T < 7 then
      if T > 5.5 then down.W = true; x = x + 4 * dt end
      if math.abs(T - 6.5) < dt / 2 then pressed.END = true end
    elseif T < 10 then
      if y > 0 then vy = vy - 9.8 * dt; y = math.max(0, y + vy * dt) else vy = 0 end
      x = x + 3 * dt
    elseif T < 11 then cam_dist = 1.4; down.D = true; z = z + 3 * dt
    elseif T < 16 then down.W = true; x = x + 4 * dt; y = y - 2 * dt; heading = 1.2
    elseif T < 18 then vy = vy - 9.8 * dt; y = y + vy * dt
    elseif T < 18.5 then -- dead
    elseif T < 20 then
      if T < 18.5 + dt then x, y, z, vy = 24, 0.02, -30, 0 end
      down.S = true; z = z - 4 * dt
    elseif T < 22 then playing, state = false, 6
    elseif T < 24 then
      playing, state = true, 5; down.A = true; z = z - 3 * dt
      if math.abs(T - 23) < dt / 2 then pressed.END = true end
    else playing, state = false, 2 end
    frame()
  end
elseif SCENARIO == "reenter" then
  -- Into the match, out to the lobby and straight back, all within the same second of the date.
  for f = 0, 90 do
    T = f * dt
    playing, state = not (f >= 30 and f < 40), (f >= 30 and f < 40) and 2 or 5
    x = x + 3 * dt
    frame()
  end
  playing, state = false, 2
  frame()
end

local out = {}
for _, path in ipairs(order) do
  if files[path] then out[#out + 1] = "### " .. path .. "\n" .. table.concat(files[path]) end
end
RESULT = table.concat(out)
LOG = table.concat(logs, "\n")
