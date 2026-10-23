-- SR1 Map Studio Companion
--
-- Two helpers for testing maps made with SR1 Map Studio:
--   surfaces.lua  custom textures get the surface their name asks for
--                 (footsteps and bullet impacts), not concrete;
--   reload.lua    reloads the multiplayer map you're playing, on a key or
--                 by itself when the map is installed again.
-- Settings are in mod.ini. Written for Lua 5.4 (Windows) and 5.5 (Mac).

local function setting(name, default)
  local v = wml.setting(name, default)
  if type(default) == "string" then
    v = tostring(v)
    if v == '""' then v = "" end
  end
  return v
end

local debug = setting("debug", false) == true

if setting("surface_fix", true) == true then
  require("surfaces").install(debug)
end

local RELOAD = require("reload")
RELOAD.setup({
  key = setting("reload_key", "F7"),
  auto = setting("auto_reload", true) == true,
  poll_seconds = math.max(0.25, tonumber(setting("poll_seconds", 1.0)) or 1.0),
  watch_folder = setting("watch_folder", ""),
  hud = setting("hud_messages", false) == true,
}, debug)

-- The game update (main thread, about 50 times a second): the only place
-- that calls game functions.
wml.hook(0x82209E30, function(ctx)
  ctx:call_original()
  RELOAD.update(ctx)
end)

wml.log("SR1 Map Studio Companion loaded" .. (debug and " (debug log on)" or ""))
