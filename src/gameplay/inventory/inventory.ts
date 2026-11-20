import { BlockId, getBlockDef, isValidBlockId, PLACEABLE_BLOCKS } from '@/world/blocks/blocks';
import type { GameMode } from '../modes/gameMode';

export interface ItemStack {
  readonly block: BlockId;
  readonly count: number;
}

export type Slot = ItemStack | null;

/** Immutable inventory value. Slots 0..8 are the hotbar; the rest is the backpack. */
export interface Inventory {
  readonly slots: readonly Slot[];
  /** Selected hotbar index, 0..8. */
  readonly selected: number;
}

export const HOTBAR_SIZE = 9;
export const ROW_SIZE = 9;
export const BASE_BAG_ROWS = 3;
export const MAX_BAG_ROWS = 6;
export const MAX_STACK = 64;

export function slotCount(bagRows: number): number {
  return HOTBAR_SIZE + bagRows * ROW_SIZE;
}

export function bagRows(inventory: Inventory): number {
  return (inventory.slots.length - HOTBAR_SIZE) / ROW_SIZE;
}

export function createInventory(rows = BASE_BAG_ROWS): Inventory {
  return { slots: new Array<Slot>(slotCount(rows)).fill(null), selected: 0 };
}

function isHoldable(block: number): block is BlockId {
  return isValidBlockId(block) && getBlockDef(block).placeable;
}

/** Starting items for a new world. */
export function starterInventory(mode: GameMode): Inventory {
  const inventory = createInventory();
  const slots = [...inventory.slots];
  if (mode === 'creative') {
    const hotbar: BlockId[] = [
      BlockId.Grass,
      BlockId.Dirt,
      BlockId.Stone,
      BlockId.Cobblestone,
      BlockId.Planks,
      BlockId.Log,
      BlockId.Glass,
      BlockId.Brick,
      BlockId.Tnt,
    ];
    hotbar.forEach((block, i) => (slots[i] = { block, count: MAX_STACK }));
  } else {
    slots[0] = { block: BlockId.Planks, count: 32 };
    slots[1] = { block: BlockId.Cobblestone, count: 32 };
    slots[2] = { block: BlockId.Glass, count: 16 };
    slots[3] = { block: BlockId.Tnt, count: 4 };
  }
  return { slots, selected: 0 };
}

export function selectedStack(inventory: Inventory): Slot {
  return inventory.slots[inventory.selected] ?? null;
}

export function selectSlot(inventory: Inventory, index: number): Inventory {
  if (!Number.isInteger(index) || index < 0 || index >= HOTBAR_SIZE) return inventory;
  return index === inventory.selected ? inventory : { ...inventory, selected: index };
}

/** Moves the hotbar selection by `direction` (±1), wrapping around. */
export function cycleSelection(inventory: Inventory, direction: number): Inventory {
  const next = (((inventory.selected + direction) % HOTBAR_SIZE) + HOTBAR_SIZE) % HOTBAR_SIZE;
  return selectSlot(inventory, next);
}

/**
 * Adds items, topping up existing stacks before using empty slots.
 * `leftover` is the amount that did not fit.
 */
export function addItem(
  inventory: Inventory,
  block: number,
  count: number,
): { inventory: Inventory; leftover: number } {
  if (!isHoldable(block) || count <= 0) return { inventory, leftover: Math.max(0, count) };
  const slots = [...inventory.slots];
  let remaining = Math.floor(count);

  for (let i = 0; i < slots.length && remaining > 0; i++) {
    const slot = slots[i];
    if (slot && slot.block === block && slot.count < MAX_STACK) {
      const moved = Math.min(MAX_STACK - slot.count, remaining);
      slots[i] = { block, count: slot.count + moved };
      remaining -= moved;
    }
  }
  for (let i = 0; i < slots.length && remaining > 0; i++) {
    if (!slots[i]) {
      const moved = Math.min(MAX_STACK, remaining);
      slots[i] = { block, count: moved };
      remaining -= moved;
    }
  }
  return { inventory: { ...inventory, slots }, leftover: remaining };
}

/** Removes up to `count` items from one slot. */
export function removeFromSlot(inventory: Inventory, index: number, count = 1): Inventory {
  const slot = inventory.slots[index];
  if (!slot || count <= 0) return inventory;
  const slots = [...inventory.slots];
  const left = slot.count - count;
  slots[index] = left > 0 ? { block: slot.block, count: left } : null;
  return { ...inventory, slots };
}

export function setSlot(inventory: Inventory, index: number, slot: Slot): Inventory {
  if (index < 0 || index >= inventory.slots.length) return inventory;
  const slots = [...inventory.slots];
  slots[index] = slot;
  return { ...inventory, slots };
}

export function countOf(inventory: Inventory, block: number): number {
  let total = 0;
  for (const slot of inventory.slots) if (slot?.block === block) total += slot.count;
  return total;
}

/**
 * Resolves a click on a slot while the pointer may be carrying a stack.
 * Primary click: pick up / put down / merge / swap. Secondary click: take half
 * or drop a single item.
 */
export function clickSlot(
  inventory: Inventory,
  cursor: Slot,
  index: number,
  secondary = false,
): { inventory: Inventory; cursor: Slot } {
  if (index < 0 || index >= inventory.slots.length) return { inventory, cursor };
  const slot = inventory.slots[index] ?? null;

  if (!cursor) {
    if (!slot) return { inventory, cursor };
    if (secondary && slot.count > 1) {
      const taken = Math.ceil(slot.count / 2);
      return {
        inventory: setSlot(inventory, index, { block: slot.block, count: slot.count - taken }),
        cursor: { block: slot.block, count: taken },
      };
    }
    return { inventory: setSlot(inventory, index, null), cursor: slot };
  }

  if (!slot) {
    if (secondary && cursor.count > 1) {
      return {
        inventory: setSlot(inventory, index, { block: cursor.block, count: 1 }),
        cursor: { block: cursor.block, count: cursor.count - 1 },
      };
    }
    return { inventory: setSlot(inventory, index, cursor), cursor: null };
  }

  if (slot.block === cursor.block) {
    const moved = Math.min(secondary ? 1 : cursor.count, MAX_STACK - slot.count);
    if (moved <= 0) return { inventory, cursor };
    const left = cursor.count - moved;
    return {
      inventory: setSlot(inventory, index, { block: slot.block, count: slot.count + moved }),
      cursor: left > 0 ? { block: cursor.block, count: left } : null,
    };
  }

  // Different items: swap.
  return { inventory: setSlot(inventory, index, cursor), cursor: slot };
}

export function canExpand(inventory: Inventory): boolean {
  return bagRows(inventory) < MAX_BAG_ROWS;
}

/** Adds one more backpack row, up to the maximum. */
export function expandInventory(inventory: Inventory): Inventory {
  if (!canExpand(inventory)) return inventory;
  return { ...inventory, slots: [...inventory.slots, ...new Array<Slot>(ROW_SIZE).fill(null)] };
}

/**
 * Puts `block` in the player's hand (creative "pick block"): selects it if it
 * is already on the hotbar, otherwise replaces the selected slot.
 */
export function pickBlock(inventory: Inventory, block: number): Inventory {
  if (!isHoldable(block)) return inventory;
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    if (inventory.slots[i]?.block === block) return selectSlot(inventory, i);
  }
  return setSlot(inventory, inventory.selected, { block, count: MAX_STACK });
}

/** Rebuilds a valid inventory from untrusted (saved) data. */
export function sanitizeInventory(raw: unknown): Inventory {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const rawSlots = Array.isArray(r.slots) ? r.slots : [];
  const extra = Math.max(0, rawSlots.length - HOTBAR_SIZE);
  const rows = Math.min(MAX_BAG_ROWS, Math.max(BASE_BAG_ROWS, Math.ceil(extra / ROW_SIZE)));
  const slots = new Array<Slot>(slotCount(rows)).fill(null);
  for (let i = 0; i < slots.length; i++) {
    const item = rawSlots[i] as { block?: unknown; count?: unknown } | null | undefined;
    if (!item || !isHoldable(item.block as number)) continue;
    const count = typeof item.count === 'number' ? Math.floor(item.count) : 0;
    if (count > 0) slots[i] = { block: item.block as BlockId, count: Math.min(MAX_STACK, count) };
  }
  const selected =
    typeof r.selected === 'number' &&
    Number.isInteger(r.selected) &&
    r.selected >= 0 &&
    r.selected < HOTBAR_SIZE
      ? r.selected
      : 0;
  return { slots, selected };
}

/** Every block that can appear in the creative palette. */
export const PALETTE_BLOCKS: readonly BlockId[] = PLACEABLE_BLOCKS;
