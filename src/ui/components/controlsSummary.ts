import { formatCode, primaryKeyLabel, type ActionId, type Bindings } from '@/core/input/actions';

/** Short "key → what it does" list for the main menu, derived from the current bindings. */
export function controlsSummary(bindings: Bindings): Array<[key: string, action: string]> {
  const key = (action: ActionId): string => primaryKeyLabel(bindings, action);
  const movement = (['moveForward', 'moveLeft', 'moveBack', 'moveRight'] as const).map(
    (action) => bindings[action][0],
  );
  const move = movement.every((code) => code !== undefined)
    ? movement.map((code) => formatCode(code!)).join(' ')
    : 'Unbound';
  return [
    [move, 'Move'],
    ['Mouse', 'Look'],
    [key('jump'), 'Jump · fly up'],
    [key('sprint'), 'Sprint'],
    [key('breakBlock'), 'Break'],
    [key('placeBlock'), 'Place · light TNT'],
    ['1–9 · Wheel', 'Select block'],
    [key('inventory'), 'Inventory'],
    [key('toggleFly'), 'Toggle flying'],
    [key('thirdPerson'), 'Third person'],
    ['Esc', 'Pause'],
  ];
}

/** Loading-screen tips that mention keys, phrased with the current bindings. */
export function gameplayTips(bindings: Bindings): string[] {
  const key = (action: ActionId): string => primaryKeyLabel(bindings, action);
  return [
    `Double-tap ${key('jump')} in Creative mode to start flying.`,
    `Use ${key('placeBlock')} on a TNT block to light the fuse — then run.`,
    `${key('pickBlock')} on a block in Creative mode picks it.`,
    `Press ${key('thirdPerson')} to see yourself in third person.`,
    `Press ${key('debugOverlay')} for coordinates and performance numbers.`,
    'Every control can be changed in Settings → Controls.',
    'The same seed always generates the same world.',
  ];
}
