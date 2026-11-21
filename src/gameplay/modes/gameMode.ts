export type GameMode = 'creative' | 'survival';

export interface GameModeRules {
  label: string;
  description: string;
  /** Blocks are never used up and break instantly. */
  infiniteBlocks: boolean;
  canFly: boolean;
  /** Targeting distance in blocks. */
  reach: number;
  /** Extra jumps allowed before landing. */
  airJumps: number;
  canDash: boolean;
}

export const GAME_MODES: Record<GameMode, GameModeRules> = {
  creative: {
    label: 'Creative',
    description: 'Unlimited blocks, instant breaking and flight.',
    infiniteBlocks: true,
    canFly: true,
    reach: 8,
    airJumps: 1,
    canDash: true,
  },
  survival: {
    label: 'Survival',
    description: 'Gather what you build with. Blocks take time to mine.',
    infiniteBlocks: false,
    canFly: false,
    reach: 5.5,
    airJumps: 0,
    canDash: false,
  },
};

export function isGameMode(value: unknown): value is GameMode {
  return value === 'creative' || value === 'survival';
}
