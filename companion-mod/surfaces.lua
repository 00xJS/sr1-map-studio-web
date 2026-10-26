-- SR1 Map Studio Companion - surface sounds fix.
--
-- A texture's surface (what footsteps and bullet impacts sound and look like)
-- comes from the two letters before the first "." in its name, after a "_":
-- "mymap_3_1a2b3c4d_me.tga" is metal. The game classifies a texture when its
-- record is created, but a custom map's textures are looked up before the
-- map's texture file is loaded, and the record made then is overwritten with
-- the game's placeholder, which is concrete. The real texture never gets
-- classified again, so the whole map plays as concrete.
--
-- This hooks the function that creates those records (0x82644AC0, name in
-- r3, returns the new record index or -1), lets it run, and then writes the
-- surface the name asks for into the new record (u16 at +10 of the 20-byte
-- records at *0x832B6024), using the game's own rule and suffix list.

local M = {}

local CREATE_RECORD = 0x82644AC0
local RECORDS = 0x832B6024  -- pointer to the texture records, 20 bytes each
local SURFACE = 10          -- u16 surface id in a record

-- The game's suffix list, in its order (index = surface id).
local SUFFIXES = { "co", "cb", "ca", "ce", "dt", "dw", "fl", "lv", "gh", "gm", "gl",
  "gs", "gv", "ma", "fm", "me", "tm", "pl", "rb", "sa", "wa", "wo" }
local ID = {}
for i, s in ipairs(SUFFIXES) do ID[s] = i - 1 end

local function cstr(addr, max)
  local t = {}
  for i = 0, max - 1 do
    local b = wml.read_u8(addr + i)
    if b == 0 then break end
    t[#t + 1] = string.char(b)
  end
  return table.concat(t)
end

-- The game's rule: the text before the first "." (or the whole name) must be
-- at least 4 characters, with "_" third from its end; the last two
-- characters are the suffix, compared without case. Returns the suffix and
-- its surface id, or nil.
function M.classify(name)
  local dot = name:find(".", 1, true)
  local stem = dot and dot - 1 or #name
  if stem < 4 or name:sub(stem - 2, stem - 2) ~= "_" then return nil end
  local suffix = name:sub(stem - 1, stem):lower()
  local id = ID[suffix]
  if id == nil then return nil end
  return suffix, id
end

function M.install(debug)
  local fixed = 0
  wml.hook(CREATE_RECORD, function(ctx)
    -- Read the name first: the game's function reuses r3 for its result.
    local name_addr = ctx:r(3) & 0xFFFFFFFF
    local name = name_addr ~= 0 and cstr(name_addr, 128) or ""
    ctx:call_original()
    local index = ctx:r(3) & 0xFFFFFFFF
    if index >= 0x80000000 then return end  -- -1: the table is full
    local suffix, id = M.classify(name)
    -- Concrete (0) is what the record already has.
    if not id or id == 0 then return end
    wml.write_u16(wml.read_u32(RECORDS) + index * 20 + SURFACE, id)
    fixed = fixed + 1
    if debug then
      wml.log(string.format("surface: %s -> %s (%d), record %d, %d fixed so far", name, suffix, id, index, fixed))
    end
  end)
  if debug then wml.log("surface fix: hooked texture record creation") end
end

return M
