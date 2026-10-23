// How the site made a texture: generated from settings, or a starter-library
// image. A shared play link carries these recipes instead of image bytes, and
// the viewer's browser remakes the textures, so no uploaded picture is ever shared.
import type { GenParams } from './procedural'

export type TextureRecipe = { gen: GenParams } | { lib: string }

const made = new WeakMap<Blob, TextureRecipe>()

/** Marks a file the site just made, so storeFile records its recipe. Returns the same file. */
export function tagRecipe<T extends Blob>(file: T, recipe: TextureRecipe): T {
  made.set(file, 'gen' in recipe ? { gen: { ...recipe.gen } } : recipe)
  return file
}

export const recipeOf = (file: Blob): TextureRecipe | undefined => made.get(file)
