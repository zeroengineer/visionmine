type Child = Node | string | null | undefined | false;

interface ElementOptions {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void }>;
}

/** Small hyperscript helper for building DOM without a framework. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.class) el.className = options.class;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) el.setAttribute(name, value);
  }
  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) {
      el.addEventListener(type, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** A UI piece with an element and a way to release its subscriptions. */
export interface View {
  readonly el: HTMLElement;
  dispose(): void;
}
