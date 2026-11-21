/**
 * The game's input actions and the keys or mouse buttons bound to them.
 * Binding codes are `KeyboardEvent.code` values or `Mouse0`–`Mouse2`.
 * This module is plain data and pure functions; it does not touch the DOM.
 */

export type ActionCategory = 'movement' | 'building' | 'interface';

export const CATEGORY_LABELS: Record<ActionCategory, string> = {
  movement: 'Movement',
  building: 'Building',
  interface: 'Interface',
};

interface ActionSpec {
  readonly label: string;
  readonly category: ActionCategory;
  readonly defaults: readonly string[];
}

const ACTION_SPECS = {
  moveForward: { label: 'Move forward', category: 'movement', defaults: ['KeyW', 'ArrowUp'] },
  moveBack: { label: 'Move back', category: 'movement', defaults: ['KeyS', 'ArrowDown'] },
  moveLeft: { label: 'Move left', category: 'movement', defaults: ['KeyA', 'ArrowLeft'] },
  moveRight: { label: 'Move right', category: 'movement', defaults: ['KeyD', 'ArrowRight'] },
  jump: { label: 'Jump · fly up', category: 'movement', defaults: ['Space'] },
  sprint: { label: 'Sprint', category: 'movement', defaults: ['ShiftLeft', 'ShiftRight'] },
  descend: { label: 'Sneak · fly down', category: 'movement', defaults: ['KeyC', 'ControlLeft'] },
  dash: { label: 'Dash', category: 'movement', defaults: ['KeyR'] },
  toggleFly: { label: 'Toggle flying', category: 'movement', defaults: ['KeyF'] },
  breakBlock: { label: 'Break block', category: 'building', defaults: ['Mouse0'] },
  placeBlock: { label: 'Place · light TNT', category: 'building', defaults: ['Mouse2'] },
  pickBlock: { label: 'Pick targeted block', category: 'building', defaults: ['Mouse1'] },
  swapSlot: { label: 'Previous hotbar slot', category: 'building', defaults: ['KeyQ'] },
  selectCorner: { label: 'Mark selection corner', category: 'building', defaults: ['KeyX'] },
  buildMenu: { label: 'Build tools', category: 'building', defaults: ['KeyB'] },
  undo: { label: 'Undo', category: 'building', defaults: ['KeyZ'] },
  redo: { label: 'Redo', category: 'building', defaults: ['KeyY'] },
  inventory: { label: 'Inventory', category: 'interface', defaults: ['KeyE'] },
  thirdPerson: { label: 'Third-person camera', category: 'interface', defaults: ['KeyV'] },
  debugOverlay: { label: 'Debug overlay', category: 'interface', defaults: ['F3'] },
  hideHud: { label: 'Hide interface', category: 'interface', defaults: ['F1'] },
  screenshot: { label: 'Screenshot', category: 'interface', defaults: ['F2'] },
} as const satisfies Record<string, ActionSpec>;

export type ActionId = keyof typeof ACTION_SPECS;

export interface ActionDef extends ActionSpec {
  readonly id: ActionId;
}

/** Every rebindable action, in display order. */
export const ACTIONS: readonly ActionDef[] = (Object.keys(ACTION_SPECS) as ActionId[]).map(
  (id) => ({ id, ...ACTION_SPECS[id] }),
);

export function getAction(id: ActionId): ActionDef {
  return { id, ...ACTION_SPECS[id] };
}

export function isActionId(value: unknown): value is ActionId {
  return typeof value === 'string' && Object.hasOwn(ACTION_SPECS, value);
}

/** Controls that cannot be changed, listed in Settings for completeness. */
export const FIXED_CONTROLS: ReadonlyArray<{
  label: string;
  keys: readonly string[];
  category: ActionCategory;
}> = [
  { label: 'Look', keys: ['Mouse'], category: 'movement' },
  { label: 'Select hotbar slot', keys: ['1–9', 'Wheel'], category: 'building' },
  { label: 'Pause · release mouse', keys: ['Esc'], category: 'interface' },
];

/** Number of bindings an action can have. */
export const BINDING_SLOTS = 2;

/** Bound codes per action; each list holds at most `BINDING_SLOTS` distinct codes. */
export type Bindings = Record<ActionId, string[]>;

export function defaultBindings(): Bindings {
  const bindings = {} as Bindings;
  for (const action of ACTIONS) bindings[action.id] = [...action.defaults];
  return bindings;
}

const MOUSE_CODE = /^Mouse[0-2]$/;
/** Escape belongs to the browser (it releases the mouse); digits select hotbar slots. */
const RESERVED_CODE = /^(Escape|Digit[1-9]|Meta(Left|Right)|OS(Left|Right)|ContextMenu)$/;
/** Shape of `KeyboardEvent.code` values: `KeyW`, `ShiftLeft`, `F3`, `Numpad0`, … */
const KEY_CODE = /^[A-Z][A-Za-z0-9]{0,31}$/;

/** Whether a code may be assigned to an action. */
export function isBindableCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  // Only the three buttons the game listens to; nothing else may pose as a mouse code.
  if (code.startsWith('Mouse')) return MOUSE_CODE.test(code);
  return KEY_CODE.test(code) && !RESERVED_CODE.test(code);
}

export function mouseCode(button: number): string {
  return `Mouse${button}`;
}

/**
 * Rebuilds valid bindings from untrusted (stored) data. Unknown actions and
 * invalid codes are dropped, missing actions get their defaults, and a code
 * bound to several actions is kept only for the first.
 */
export function sanitizeBindings(raw: unknown): Bindings {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const bindings = {} as Bindings;
  const used = new Set<string>();

  // Stored bindings first, so they win over the defaults of other actions.
  for (const action of ACTIONS) {
    const stored = source[action.id];
    if (!Array.isArray(stored)) continue;
    const codes: string[] = [];
    for (const code of stored) {
      if (codes.length >= BINDING_SLOTS) break;
      if (!isBindableCode(code) || used.has(code)) continue;
      used.add(code);
      codes.push(code);
    }
    bindings[action.id] = codes;
  }
  for (const action of ACTIONS) {
    if (bindings[action.id]) continue;
    const codes = action.defaults.filter((code) => !used.has(code));
    for (const code of codes) used.add(code);
    bindings[action.id] = codes;
  }
  return bindings;
}

/** The action a code triggers, or null. */
export function actionForCode(bindings: Bindings, code: string): ActionId | null {
  for (const action of ACTIONS) {
    if (bindings[action.id].includes(code)) return action.id;
  }
  return null;
}

export function buildCodeLookup(bindings: Bindings): Map<string, ActionId> {
  const lookup = new Map<string, ActionId>();
  for (const action of ACTIONS) {
    for (const code of bindings[action.id]) {
      if (!lookup.has(code)) lookup.set(code, action.id);
    }
  }
  return lookup;
}

export interface AssignResult {
  bindings: Bindings;
  /** Action that previously used the code and received the replaced one instead. */
  swappedWith: ActionId | null;
}

/**
 * Binds `code` to one slot of an action. If another action already uses the
 * code, the two exchange bindings (the other action receives whatever the slot
 * held, or loses the binding if the slot was empty), so no code is ever bound twice.
 */
export function assignBinding(
  bindings: Bindings,
  action: ActionId,
  slot: number,
  code: string,
): AssignResult {
  if (!isBindableCode(code) || slot < 0 || slot >= BINDING_SLOTS) {
    return { bindings, swappedWith: null };
  }
  const next = cloneBindings(bindings);
  const own = next[action];
  const index = Math.min(slot, own.length);
  const replaced = own[index] ?? null;
  if (replaced === code) return { bindings, swappedWith: null };

  // Already on this action's other slot: exchange the two slots.
  const ownOther = own.indexOf(code);
  if (ownOther !== -1) {
    if (replaced === null) return { bindings, swappedWith: null };
    own[ownOther] = replaced;
    own[index] = code;
    return { bindings: next, swappedWith: null };
  }

  const previousOwner = actionForCode(bindings, code);
  own[index] = code;
  if (previousOwner !== null) {
    const other = next[previousOwner];
    const otherIndex = other.indexOf(code);
    if (replaced !== null) other[otherIndex] = replaced;
    else other.splice(otherIndex, 1);
  }
  return { bindings: next, swappedWith: previousOwner };
}

/** Removes one binding slot of an action. */
export function clearBinding(bindings: Bindings, action: ActionId, slot: number): Bindings {
  if (slot < 0 || slot >= bindings[action].length) return bindings;
  const next = cloneBindings(bindings);
  next[action].splice(slot, 1);
  return next;
}

export function bindingsEqual(a: Bindings, b: Bindings): boolean {
  return ACTIONS.every(
    (action) =>
      a[action.id].length === b[action.id].length &&
      a[action.id].every((code, i) => code === b[action.id][i]),
  );
}

function cloneBindings(bindings: Bindings): Bindings {
  const next = {} as Bindings;
  for (const action of ACTIONS) next[action.id] = [...bindings[action.id]];
  return next;
}

const CODE_LABELS: Record<string, string> = {
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Space: 'Space',
  ShiftLeft: 'Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Right Alt',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Tab: 'Tab',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  CapsLock: 'Caps Lock',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
};

/** Human-readable name of a binding code, as shown on key caps. */
export function formatCode(code: string): string {
  const known = CODE_LABELS[code];
  if (known) return known;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const numpad = /^Numpad(.+)$/.exec(code);
  if (numpad) return `Num ${numpad[1]}`;
  return code;
}

/** Display text for an action's first binding, or "Unbound". */
export function primaryKeyLabel(bindings: Bindings, action: ActionId): string {
  const code = bindings[action][0];
  return code ? formatCode(code) : 'Unbound';
}
