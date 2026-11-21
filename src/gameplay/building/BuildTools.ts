import { BlockId, getBlockDef } from '@/world/blocks/blocks';
import type { World } from '@/world/World';
import { EditHistory } from './EditHistory';
import {
  clearRegion,
  copyRegion,
  fillRegion,
  isRegionLoaded,
  MAX_REGION_BLOCKS,
  pasteClipboard,
  pasteRegion,
  regionFromCorners,
  regionSize,
  regionVolume,
  replaceRegion,
  rotateClipboard,
  type Cell,
  type CellFilter,
  type Clipboard,
  type Region,
} from './regionOps';

export type BuildAction =
  'fill' | 'replace' | 'clear' | 'copy' | 'paste' | 'rotate' | 'deselect' | 'undo' | 'redo';

/** What an operation needs to know about the player at the moment it runs. */
export interface BuildContext {
  /** Block in the player's hand, or 0. */
  heldBlock: number;
  /** Cell a pasted copy should start at (the free cell against the targeted face), or null. */
  pasteOrigin: Cell | null;
  /** Cells that must not be written, such as those the player occupies. */
  skip?: CellFilter;
}

export interface BuildResult {
  ok: boolean;
  /** Short sentence for the player. */
  message: string;
}

const done = (message: string): BuildResult => ({ ok: true, message });
const refused = (message: string): BuildResult => ({ ok: false, message });
const plural = (count: number): string =>
  `${count.toLocaleString('en-US')} block${count === 1 ? '' : 's'}`;

/**
 * Creative-mode building tools: a two-corner selection, region operations on
 * it, a clipboard, and undo/redo. Holds state only; rendering and input live elsewhere.
 */
export class BuildTools {
  readonly history: EditHistory;
  private cornerA: Cell | null = null;
  private cornerB: Cell | null = null;
  private copied: Clipboard | null = null;
  private allowed = true;

  constructor(private readonly world: World) {
    this.history = new EditHistory(world);
  }

  /** Whether the current game mode permits the tools. Turning them off drops all state. */
  get enabled(): boolean {
    return this.allowed;
  }

  set enabled(value: boolean) {
    this.allowed = value;
    this.history.enabled = value;
    if (!value) {
      this.cornerA = this.cornerB = null;
      this.copied = null;
      this.history.clear();
    }
  }

  get corners(): { a: Cell | null; b: Cell | null } {
    return { a: this.cornerA, b: this.cornerB };
  }

  /** The selected region once both corners are set. */
  get selection(): Region | null {
    return this.cornerA && this.cornerB ? regionFromCorners(this.cornerA, this.cornerB) : null;
  }

  get clipboard(): Clipboard | null {
    return this.copied;
  }

  /**
   * Marks a selection corner at a block: the first call sets one corner, the
   * second the opposite one, and a third starts a new selection.
   */
  markCorner(cell: Cell | null): BuildResult {
    if (!this.allowed) return refused('Build tools are available in Creative mode.');
    if (!cell) return refused('Look at a block to mark a corner.');
    const corner = { x: cell.x, y: cell.y, z: cell.z };
    if (!this.cornerA || this.cornerB) {
      this.cornerA = corner;
      this.cornerB = null;
      return done('First corner set. Mark the opposite corner.');
    }
    this.cornerB = corner;
    const { sx, sy, sz } = regionSize(this.selection!);
    return done(`Selected ${sx} × ${sy} × ${sz}.`);
  }

  run(action: BuildAction, context: BuildContext): BuildResult {
    if (!this.allowed) return refused('Build tools are available in Creative mode.');
    switch (action) {
      case 'undo':
        return this.undo();
      case 'redo':
        return this.redo();
      case 'deselect':
        this.cornerA = this.cornerB = null;
        return done('Selection cleared.');
      case 'rotate':
        if (!this.copied) return refused('Nothing has been copied yet.');
        this.copied = rotateClipboard(this.copied);
        return done(`Copy rotated: ${this.copied.sx} × ${this.copied.sy} × ${this.copied.sz}.`);
      case 'paste':
        return this.paste(context);
      default:
        return this.onSelection(action, context);
    }
  }

  undo(): BuildResult {
    if (!this.allowed) return refused('Undo is available in Creative mode.');
    const count = this.history.undo();
    if (count === 0) return refused('Nothing to undo.');
    if (count < 0) return refused('That change is too far away to undo from here.');
    return done(`Undid ${plural(count)}.`);
  }

  redo(): BuildResult {
    if (!this.allowed) return refused('Redo is available in Creative mode.');
    const count = this.history.redo();
    if (count === 0) return refused('Nothing to redo.');
    if (count < 0) return refused('That change is too far away to redo from here.');
    return done(`Redid ${plural(count)}.`);
  }

  dispose(): void {
    this.history.dispose();
  }

  private onSelection(
    action: 'fill' | 'replace' | 'clear' | 'copy',
    context: BuildContext,
  ): BuildResult {
    const region = this.selection;
    if (!region) return refused('Mark two corners first.');
    const problem = this.checkRegion(region);
    if (problem) return refused(problem);

    if (action === 'copy') {
      this.copied = copyRegion(this.world, region);
      return done(`Copied ${plural(regionVolume(region))}.`);
    }
    if (action === 'clear') {
      this.history.commit();
      const count = clearRegion(this.world, region);
      this.history.commit();
      return done(`Cleared ${plural(count)}.`);
    }
    if (context.heldBlock === BlockId.Air) return refused('Hold a block to build with.');
    const name = getBlockDef(context.heldBlock).name;
    this.history.commit();
    const count =
      action === 'fill'
        ? fillRegion(this.world, region, context.heldBlock, context.skip)
        : replaceRegion(this.world, region, context.heldBlock);
    this.history.commit();
    return done(
      action === 'fill'
        ? `Filled ${plural(count)} with ${name}.`
        : `Replaced ${plural(count)} with ${name}.`,
    );
  }

  private paste(context: BuildContext): BuildResult {
    if (!this.copied) return refused('Nothing has been copied yet.');
    if (!context.pasteOrigin) return refused('Look at a block to paste against.');
    const problem = this.checkRegion(pasteRegion(this.copied, context.pasteOrigin));
    if (problem) return refused(problem);
    this.history.commit();
    const count = pasteClipboard(this.world, this.copied, context.pasteOrigin, context.skip);
    this.history.commit();
    return done(`Pasted ${plural(count)}.`);
  }

  private checkRegion(region: Region): string | null {
    const volume = regionVolume(region);
    if (volume > MAX_REGION_BLOCKS) {
      return `That is ${plural(volume)}; the limit is ${plural(MAX_REGION_BLOCKS)}.`;
    }
    if (!isRegionLoaded(this.world, region)) return 'Part of that area is not loaded. Move closer.';
    return null;
  }
}
