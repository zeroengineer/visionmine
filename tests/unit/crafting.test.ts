import { beforeEach, describe, expect, it } from 'vitest';
import { GRID_CELLS, gridCells, matchRecipe, RECIPES } from '@/gameplay/crafting/recipes';
import { createInventory, countOf, PALETTE_ITEMS } from '@/gameplay/inventory/inventory';
import { isValidItem, ItemId } from '@/gameplay/items/items';
import { inventoryStore } from '@/state/inventoryStore';
import { BlockId } from '@/world/blocks/blocks';

const P = BlockId.Planks;
const S = ItemId.Stick;

/** A 3 × 3 grid from rows of ids; missing cells are empty. */
function grid(...rows: number[][]): number[] {
  const cells = new Array<number>(GRID_CELLS).fill(0);
  rows.forEach((row, r) => row.forEach((id, c) => (cells[r * 3 + c] = id)));
  return cells;
}

describe('recipes', () => {
  it('only use and make real items, in patterns that fit the grid', () => {
    for (const recipe of RECIPES) {
      expect(isValidItem(recipe.result.item)).toBe(true);
      expect(recipe.result.count).toBeGreaterThan(0);
      expect(recipe.pattern.length).toBeGreaterThan(0);
      expect(recipe.pattern.length).toBeLessThanOrEqual(3);
      const width = recipe.pattern[0]!.length;
      expect(width).toBeLessThanOrEqual(3);
      for (const row of recipe.pattern) {
        expect(row.length).toBe(width);
        for (const symbol of row) {
          if (symbol !== ' ') expect(isValidItem(recipe.key[symbol])).toBe(true);
        }
      }
      // No pattern has an empty first or last row or column: it is already trimmed.
      expect(recipe.pattern[0]!.trim().length).toBeGreaterThan(0);
      expect(recipe.pattern.at(-1)!.trim().length).toBeGreaterThan(0);
    }
  });

  it('never make two different things from the same layout', () => {
    const seen = new Map<string, number>();
    for (const recipe of RECIPES) {
      const layout = recipe.pattern
        .map((row) => [...row].map((symbol) => (symbol === ' ' ? 0 : recipe.key[symbol])).join(','))
        .join('/');
      const existing = seen.get(layout);
      if (existing !== undefined) expect(existing).toBe(recipe.result.item);
      seen.set(layout, recipe.result.item);
    }
  });

  it('match wherever the ingredients are placed', () => {
    expect(matchRecipe(grid([BlockId.Log]))?.result).toEqual({ item: P, count: 4 });
    expect(matchRecipe(grid([], [0, 0, BlockId.Log]))?.result.item).toBe(P);
    // Two planks, one above the other, anywhere.
    expect(matchRecipe(grid([P], [P]))?.result).toEqual({ item: S, count: 4 });
    expect(matchRecipe(grid([0, 0, P], [0, 0, P]))?.result.item).toBe(S);
    expect(matchRecipe(grid([], [0, P], [0, P]))?.result.item).toBe(S);
  });

  it('tell layouts with the same ingredients apart', () => {
    // Side by side, two planks make nothing.
    expect(matchRecipe(grid([P, P]))).toBeNull();
    expect(matchRecipe(grid([P, P], [P, P]))?.result.item).toBe(BlockId.CraftingTable);
    expect(matchRecipe(grid([P, P], [P, P], [P, P]))?.result.item).toBe(BlockId.Door);
    expect(matchRecipe(grid([P, P, P]))?.result).toEqual({ item: BlockId.PlankSlab, count: 6 });
  });

  it('make each tool from its head and handle, mirrored or not', () => {
    expect(matchRecipe(grid([P, P, P], [0, S], [0, S]))?.result.item).toBe(ItemId.WoodPickaxe);
    const stone = BlockId.Cobblestone;
    expect(matchRecipe(grid([stone, stone], [stone, S], [0, S]))?.result.item).toBe(
      ItemId.StoneAxe,
    );
    // The axe drawn the other way round.
    expect(matchRecipe(grid([stone, stone], [S, stone], [S]))?.result.item).toBe(ItemId.StoneAxe);
    expect(matchRecipe(grid([ItemId.Iron], [S], [S]))?.result.item).toBe(ItemId.IronShovel);
    // Smooth stone works as well as cobblestone.
    expect(matchRecipe(grid([BlockId.Stone], [S], [S]))?.result.item).toBe(ItemId.StoneShovel);
    expect(matchRecipe(grid([ItemId.Coal], [S]))?.result).toEqual({
      item: BlockId.Torch,
      count: 4,
    });
    // Stairs can be built facing either way.
    expect(matchRecipe(grid([P], [P, P], [P, P, P]))?.result.item).toBe(BlockId.PlankStairs);
    expect(matchRecipe(grid([0, 0, P], [0, P, P], [P, P, P]))?.result.item).toBe(
      BlockId.PlankStairs,
    );
  });

  it('do not match with anything extra, missing or wrong', () => {
    expect(matchRecipe(grid())).toBeNull();
    expect(matchRecipe(grid([P, P, P], [0, S], [0, S, P]))).toBeNull();
    expect(matchRecipe(grid([P, P, P], [0, S]))).toBeNull();
    expect(matchRecipe(grid([P, P, P], [0, P], [0, S]))).toBeNull();
    expect(matchRecipe(grid([BlockId.Dirt]))).toBeNull();
    // Upside down is not the same thing.
    expect(matchRecipe(grid([S], [ItemId.Coal]))).toBeNull();
  });

  it('use a 2 × 2 corner of the grid in the inventory', () => {
    expect(gridCells(2)).toEqual([0, 1, 3, 4]);
    expect(gridCells(3)).toHaveLength(9);
  });
});

describe('crafting in the inventory', () => {
  const store = inventoryStore;
  const put = (cell: number, item: number, count: number): void => {
    store.setState({ cursor: { item, count } });
    store.getState().clickCraft(cell);
  };

  beforeEach(() => {
    store.getState().load(createInventory());
  });

  it('shows the result as soon as the grid matches', () => {
    expect(store.getState().craftResult).toBeNull();
    put(0, BlockId.Log, 3);
    expect(store.getState().craftResult).toEqual({ item: P, count: 4 });
    expect(store.getState().cursor).toBeNull();
  });

  it('uses one of each ingredient per batch and stacks batches on the pointer', () => {
    put(0, BlockId.Log, 3);
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: P, count: 4 });
    expect(store.getState().craft[0]).toEqual({ item: BlockId.Log, count: 2 });
    store.getState().takeCraftResult();
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: P, count: 12 });
    expect(store.getState().craft[0]).toBeNull();
    expect(store.getState().craftResult).toBeNull();
    // Nothing more to take.
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: P, count: 12 });
  });

  it('will not take a result that does not fit on the pointer', () => {
    put(0, BlockId.Log, 2);
    store.setState({ cursor: { item: BlockId.Stone, count: 1 } });
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: BlockId.Stone, count: 1 });
    expect(store.getState().craft[0]).toEqual({ item: BlockId.Log, count: 2 });

    // A full stack of the same item has no room for four more.
    store.setState({ cursor: { item: P, count: 62 } });
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: P, count: 62 });
  });

  it('makes tools with full durability, one at a time', () => {
    store.getState().openCraft(3);
    put(0, P, 1);
    put(1, P, 1);
    put(2, P, 1);
    put(4, S, 1);
    put(7, S, 1);
    expect(store.getState().craftResult).toEqual({
      item: ItemId.WoodPickaxe,
      count: 1,
      durability: 60,
    });
    store.getState().takeCraftResult();
    expect(store.getState().cursor).toEqual({ item: ItemId.WoodPickaxe, count: 1, durability: 60 });
    expect(store.getState().craft.every((slot) => slot === null)).toBe(true);
  });

  it('keeps the 3 × 3 cells out of reach away from a crafting table', () => {
    expect(store.getState().craftSide).toBe(2);
    put(2, P, 1);
    expect(store.getState().craft[2]).toBeNull();
    expect(store.getState().cursor).toEqual({ item: P, count: 1 });
    store.getState().openCraft(3);
    store.getState().clickCraft(2);
    expect(store.getState().craft[2]).toEqual({ item: P, count: 1 });
  });

  it('returns ingredients to the inventory when the grid is closed or resized', () => {
    put(0, BlockId.Log, 5);
    put(1, ItemId.Coal, 2);
    store.getState().clearCraft();
    expect(store.getState().craft.every((slot) => slot === null)).toBe(true);
    expect(store.getState().craftResult).toBeNull();
    const inventory = store.getState().snapshot();
    expect(countOf(inventory, BlockId.Log)).toBe(5);
    expect(countOf(inventory, ItemId.Coal)).toBe(2);

    put(0, P, 4);
    store.getState().openCraft(3);
    expect(store.getState().craftSide).toBe(3);
    expect(countOf(store.getState().snapshot(), P)).toBe(4);
  });

  it('offers every item in the creative palette', () => {
    expect(PALETTE_ITEMS).toContain(BlockId.CraftingTable);
    expect(PALETTE_ITEMS).toContain(ItemId.IronPickaxe);
    expect(PALETTE_ITEMS).not.toContain(BlockId.DoorUpper);
    expect(new Set(PALETTE_ITEMS).size).toBe(PALETTE_ITEMS.length);
    store.getState().grab(ItemId.StoneAxe);
    expect(store.getState().cursor).toEqual({ item: ItemId.StoneAxe, count: 1, durability: 132 });
    store.getState().grab(ItemId.Apple);
    expect(store.getState().cursor).toEqual({ item: ItemId.Apple, count: 64 });
  });
});
