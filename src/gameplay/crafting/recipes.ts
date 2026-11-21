import { BlockId } from '@/world/blocks/blocks';
import { ItemId } from '../items/items';

export interface Recipe {
  /**
   * Rows of the smallest rectangle the ingredients occupy. Each character is a
   * key into `key`; a space is an empty cell.
   */
  readonly pattern: readonly string[];
  readonly key: Readonly<Record<string, number>>;
  readonly result: { readonly item: number; readonly count: number };
}

const B = BlockId;
const I = ItemId;

function toolRecipes(material: number, pickaxe: number, axe: number, shovel: number): Recipe[] {
  const key = { M: material, S: I.Stick };
  return [
    { pattern: ['MMM', ' S ', ' S '], key, result: { item: pickaxe, count: 1 } },
    { pattern: ['MM', 'MS', ' S'], key, result: { item: axe, count: 1 } },
    { pattern: ['M', 'S', 'S'], key, result: { item: shovel, count: 1 } },
  ];
}

function cutRecipes(material: number, slab: number, stairs: number): Recipe[] {
  const key = { M: material };
  return [
    { pattern: ['MMM'], key, result: { item: slab, count: 6 } },
    { pattern: ['M  ', 'MM ', 'MMM'], key, result: { item: stairs, count: 4 } },
  ];
}

/** Every recipe. Small ones fit the 2 × 2 grid in the inventory; the rest need a crafting table. */
export const RECIPES: readonly Recipe[] = [
  { pattern: ['L'], key: { L: B.Log }, result: { item: B.Planks, count: 4 } },
  { pattern: ['P', 'P'], key: { P: B.Planks }, result: { item: I.Stick, count: 4 } },
  { pattern: ['PP', 'PP'], key: { P: B.Planks }, result: { item: B.CraftingTable, count: 1 } },
  { pattern: ['C', 'S'], key: { C: I.Coal, S: I.Stick }, result: { item: B.Torch, count: 4 } },
  ...toolRecipes(B.Planks, I.WoodPickaxe, I.WoodAxe, I.WoodShovel),
  ...toolRecipes(B.Cobblestone, I.StonePickaxe, I.StoneAxe, I.StoneShovel),
  ...toolRecipes(B.Stone, I.StonePickaxe, I.StoneAxe, I.StoneShovel),
  ...toolRecipes(I.Iron, I.IronPickaxe, I.IronAxe, I.IronShovel),
  ...cutRecipes(B.Stone, B.StoneSlab, B.StoneStairs),
  ...cutRecipes(B.Planks, B.PlankSlab, B.PlankStairs),
  ...cutRecipes(B.Cobblestone, B.CobbleSlab, B.CobbleStairs),
  ...cutRecipes(B.Brick, B.BrickSlab, B.BrickStairs),
  { pattern: ['PP', 'PP', 'PP'], key: { P: B.Planks }, result: { item: B.Door, count: 1 } },
  { pattern: ['S S', 'SSS', 'S S'], key: { S: I.Stick }, result: { item: B.Ladder, count: 3 } },
  { pattern: ['GGG', 'GGG'], key: { G: B.Glass }, result: { item: B.GlassPane, count: 16 } },
];

/** Side of the crafting grid as stored: always 3 × 3, of which a 2 × 2 corner may be in use. */
export const GRID_SIDE = 3;
export const GRID_CELLS = GRID_SIDE * GRID_SIDE;

/** Indices of the cells available for a grid of the given side (2 or 3). */
export function gridCells(side: number): number[] {
  const cells: number[] = [];
  for (let row = 0; row < side; row++) {
    for (let column = 0; column < side; column++) cells.push(row * GRID_SIDE + column);
  }
  return cells;
}

/**
 * Finds the recipe laid out in a 3 × 3 grid of item ids (0 = empty). The
 * ingredients may sit anywhere in the grid and may be mirrored left to right,
 * but nothing else may be in it.
 */
export function matchRecipe(grid: readonly number[]): Recipe | null {
  let minRow = GRID_SIDE;
  let maxRow = -1;
  let minColumn = GRID_SIDE;
  let maxColumn = -1;
  for (let i = 0; i < GRID_CELLS; i++) {
    if (!grid[i]) continue;
    const row = Math.floor(i / GRID_SIDE);
    const column = i % GRID_SIDE;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minColumn = Math.min(minColumn, column);
    maxColumn = Math.max(maxColumn, column);
  }
  if (maxRow < 0) return null;
  const height = maxRow - minRow + 1;
  const width = maxColumn - minColumn + 1;

  for (const recipe of RECIPES) {
    if (recipe.pattern.length !== height || recipe.pattern[0]!.length !== width) continue;
    for (const mirrored of [false, true]) {
      let matches = true;
      for (let row = 0; row < height && matches; row++) {
        for (let column = 0; column < width && matches; column++) {
          const symbol = recipe.pattern[row]![mirrored ? width - 1 - column : column]!;
          const wanted = symbol === ' ' ? 0 : recipe.key[symbol]!;
          const actual = grid[(minRow + row) * GRID_SIDE + minColumn + column] ?? 0;
          matches = wanted === actual;
        }
      }
      if (matches) return recipe;
    }
  }
  return null;
}
