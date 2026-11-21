import { describe, expect, it } from 'vitest';
import {
  addItem,
  bagRows,
  canExpand,
  clickSlot,
  countOf,
  createInventory,
  cycleSelection,
  expandInventory,
  HOTBAR_SIZE,
  MAX_BAG_ROWS,
  MAX_STACK,
  pickBlock,
  removeFromSlot,
  sanitizeInventory,
  selectedStack,
  selectSlot,
  starterInventory,
} from '@/gameplay/inventory/inventory';
import { inventoryStore } from '@/state/inventoryStore';
import { sanitizeSettings, settingsStore } from '@/state/settingsStore';
import { BlockId } from '@/world/blocks/blocks';

describe('inventory model', () => {
  it('starts with 9 hotbar slots and 3 backpack rows', () => {
    const inv = createInventory();
    expect(inv.slots).toHaveLength(36);
    expect(bagRows(inv)).toBe(3);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('stacks items, then fills empty slots, and reports leftovers', () => {
    let inv = createInventory();
    inv = addItem(inv, BlockId.Stone, 10).inventory;
    inv = addItem(inv, BlockId.Stone, 60).inventory;
    expect(inv.slots[0]).toEqual({ item: BlockId.Stone, count: MAX_STACK });
    expect(inv.slots[1]).toEqual({ item: BlockId.Stone, count: 6 });
    expect(countOf(inv, BlockId.Stone)).toBe(70);

    const full = addItem(createInventory(), BlockId.Dirt, 36 * MAX_STACK + 5);
    expect(full.leftover).toBe(5);
    expect(full.inventory.slots.every((s) => s?.count === MAX_STACK)).toBe(true);
  });

  it('rejects air, bedrock and unknown blocks', () => {
    const inv = createInventory();
    expect(addItem(inv, BlockId.Air, 5).leftover).toBe(5);
    expect(addItem(inv, BlockId.Bedrock, 1).inventory).toBe(inv);
    expect(addItem(inv, 250, 1).inventory).toBe(inv);
  });

  it('removes items and clears empty slots without mutating the original', () => {
    const inv = addItem(createInventory(), BlockId.Glass, 3).inventory;
    const after = removeFromSlot(inv, 0, 2);
    expect(after.slots[0]).toEqual({ item: BlockId.Glass, count: 1 });
    expect(inv.slots[0]).toEqual({ item: BlockId.Glass, count: 3 });
    expect(removeFromSlot(after, 0, 1).slots[0]).toBeNull();
    expect(removeFromSlot(after, 5, 1)).toBe(after);
  });

  it('selects and cycles hotbar slots with wrap-around', () => {
    let inv = createInventory();
    inv = selectSlot(inv, 4);
    expect(inv.selected).toBe(4);
    expect(selectSlot(inv, 9)).toBe(inv);
    expect(selectSlot(inv, -1)).toBe(inv);
    expect(cycleSelection(selectSlot(inv, 8), 1).selected).toBe(0);
    expect(cycleSelection(selectSlot(inv, 0), -1).selected).toBe(HOTBAR_SIZE - 1);
    const held = addItem(selectSlot(createInventory(), 0), BlockId.Brick, 2).inventory;
    expect(selectedStack(held)).toEqual({ item: BlockId.Brick, count: 2 });
  });

  it('moves, merges, swaps and splits stacks with the pointer', () => {
    let inv = addItem(createInventory(), BlockId.Stone, 10).inventory;
    inv = {
      ...inv,
      slots: inv.slots.map((s, i) => (i === 1 ? { item: BlockId.Dirt, count: 4 } : s)),
    };

    // Pick up, then put down in an empty slot.
    let step = clickSlot(inv, null, 0);
    expect(step.cursor).toEqual({ item: BlockId.Stone, count: 10 });
    expect(step.inventory.slots[0]).toBeNull();
    step = clickSlot(step.inventory, step.cursor, 20);
    expect(step.cursor).toBeNull();
    expect(step.inventory.slots[20]).toEqual({ item: BlockId.Stone, count: 10 });

    // Swap with a different item.
    step = clickSlot(step.inventory, { item: BlockId.Glass, count: 2 }, 1);
    expect(step.cursor).toEqual({ item: BlockId.Dirt, count: 4 });
    expect(step.inventory.slots[1]).toEqual({ item: BlockId.Glass, count: 2 });

    // Merge respects the stack limit.
    const nearlyFull = addItem(createInventory(), BlockId.Stone, 60).inventory;
    const merged = clickSlot(nearlyFull, { item: BlockId.Stone, count: 10 }, 0);
    expect(merged.inventory.slots[0]?.count).toBe(MAX_STACK);
    expect(merged.cursor).toEqual({ item: BlockId.Stone, count: 6 });

    // Secondary click: take half, drop one.
    const half = clickSlot(nearlyFull, null, 0, true);
    expect(half.cursor?.count).toBe(30);
    expect(half.inventory.slots[0]?.count).toBe(30);
    const one = clickSlot(createInventory(), { item: BlockId.Log, count: 5 }, 3, true);
    expect(one.inventory.slots[3]).toEqual({ item: BlockId.Log, count: 1 });
    expect(one.cursor?.count).toBe(4);
  });

  it('expands by one row at a time up to the maximum', () => {
    let inv = createInventory();
    let rows = 3;
    while (canExpand(inv)) {
      inv = expandInventory(inv);
      rows++;
      expect(bagRows(inv)).toBe(rows);
    }
    expect(rows).toBe(MAX_BAG_ROWS);
    expect(expandInventory(inv)).toBe(inv);
    expect(inv.slots).toHaveLength(HOTBAR_SIZE + MAX_BAG_ROWS * 9);
  });

  it('picks blocks: selects an existing hotbar stack or replaces the held slot', () => {
    const inv = starterInventory('creative');
    const stoneIndex = inv.slots.findIndex((s) => s?.item === BlockId.Stone);
    expect(pickBlock(inv, BlockId.Stone).selected).toBe(stoneIndex);
    const picked = pickBlock(selectSlot(inv, 2), BlockId.Snow);
    expect(picked.slots[2]).toEqual({ item: BlockId.Snow, count: MAX_STACK });
    expect(pickBlock(inv, BlockId.Bedrock)).toBe(inv);
  });

  it('gives different starter kits per mode', () => {
    expect(
      starterInventory('creative')
        .slots.slice(0, 9)
        .every((s) => s !== null),
    ).toBe(true);
    const survival = starterInventory('survival');
    expect(countOf(survival, BlockId.Planks)).toBe(32);
    expect(survival.slots.filter(Boolean).length).toBeLessThan(9);
  });

  it('rebuilds a valid inventory from damaged data', () => {
    const clean = sanitizeInventory({
      selected: 42,
      slots: [
        { item: BlockId.Stone, count: 500 },
        { block: 999, count: 3 },
        { item: BlockId.Dirt, count: -2 },
        'junk',
        null,
        { item: BlockId.Bedrock, count: 1 },
      ],
    });
    expect(clean.selected).toBe(0);
    expect(clean.slots).toHaveLength(36);
    expect(clean.slots[0]).toEqual({ item: BlockId.Stone, count: MAX_STACK });
    expect(clean.slots.slice(1).every((s) => s === null)).toBe(true);
    expect(sanitizeInventory(null).slots).toHaveLength(36);
    expect(sanitizeInventory({ slots: new Array(54).fill(null) }).slots).toHaveLength(54);
    expect(sanitizeInventory({ slots: new Array(500).fill(null) }).slots).toHaveLength(63);
  });
});

describe('inventory store', () => {
  it('tracks quantities through add, consume, select and expand', () => {
    const store = inventoryStore.getState();
    store.load(createInventory());
    expect(store.add(BlockId.Planks, 3)).toBe(0);
    inventoryStore.getState().consumeSelected();
    expect(inventoryStore.getState().slots[0]).toEqual({ item: BlockId.Planks, count: 2 });
    inventoryStore.getState().consumeSelected(2);
    expect(inventoryStore.getState().slots[0]).toBeNull();

    inventoryStore.getState().cycle(-1);
    expect(inventoryStore.getState().selected).toBe(8);
    inventoryStore.getState().select(3);
    expect(inventoryStore.getState().selected).toBe(3);
    inventoryStore.getState().expand();
    expect(inventoryStore.getState().slots).toHaveLength(45);
  });

  it('carries palette stacks on the pointer and returns them on close', () => {
    inventoryStore.getState().load(createInventory());
    inventoryStore.getState().grab(BlockId.Brick);
    expect(inventoryStore.getState().cursor).toEqual({ item: BlockId.Brick, count: MAX_STACK });
    inventoryStore.getState().click(12);
    expect(inventoryStore.getState().cursor).toBeNull();
    expect(inventoryStore.getState().slots[12]?.item).toBe(BlockId.Brick);
    inventoryStore.getState().grab(BlockId.Glass);
    inventoryStore.getState().dropCursor();
    expect(inventoryStore.getState().cursor).toBeNull();
    expect(countOf(inventoryStore.getState().snapshot(), BlockId.Glass)).toBe(MAX_STACK);
  });
});

describe('settings', () => {
  it('clamps and repairs stored settings', () => {
    const base = sanitizeSettings({}, settingsStore.getState());
    const fixed = sanitizeSettings(
      {
        fov: 500,
        renderDistance: 0.4,
        sensitivity: 'fast',
        quality: 'ultra',
        shadows: 'yes',
        volume: -3,
      },
      base,
    );
    expect(fixed.fov).toBe(110);
    expect(fixed.renderDistance).toBe(2);
    expect(fixed.sensitivity).toBe(base.sensitivity);
    expect(fixed.quality).toBe(base.quality);
    expect(fixed.shadows).toBe(base.shadows);
    expect(fixed.volume).toBe(0);
  });

  it('applies presets and updates through the store', () => {
    settingsStore.getState().applyQualityPreset('low');
    expect(settingsStore.getState()).toMatchObject({
      quality: 'low',
      renderDistance: 4,
      shadows: false,
    });
    settingsStore.getState().set({ renderDistance: 99 });
    expect(settingsStore.getState().renderDistance).toBe(12);
  });
});
