// fengari (a Lua VM in JavaScript) ships no types; tests/playtestLua.test.ts uses a handful of its C-style calls.
declare module 'fengari' {
  export const lua: any
  export const lauxlib: any
  export const lualib: any
  export function to_luastring(s: string): Uint8Array
  export function to_jsstring(s: Uint8Array): string
}
