import { h } from './dom';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export interface ButtonOptions {
  variant?: ButtonVariant;
  small?: boolean;
  wide?: boolean;
  id?: string;
}

export function button(
  label: string,
  onClick: (event: MouseEvent) => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  const classes = ['btn'];
  if (options.variant && options.variant !== 'primary') classes.push(`btn--${options.variant}`);
  if (options.small) classes.push('btn--small');
  if (options.wide) classes.push('btn--wide');
  const el = h('button', {
    class: classes.join(' '),
    text: label,
    attrs: { type: 'button', ...(options.id ? { 'data-testid': options.id } : {}) },
    on: { click: onClick },
  });
  return el;
}

/**
 * Button that asks for a second click before running a destructive action.
 * Reverts to its normal label after a few seconds.
 */
export function confirmButton(
  label: string,
  confirmLabel: string,
  onConfirm: () => void,
  options: ButtonOptions = {},
): HTMLButtonElement {
  let armed = false;
  let timer = 0;
  const el = button(
    label,
    () => {
      if (!armed) {
        armed = true;
        el.textContent = confirmLabel;
        el.classList.add('is-armed');
        timer = window.setTimeout(disarm, 3500);
        return;
      }
      disarm();
      onConfirm();
    },
    options,
  );
  function disarm(): void {
    armed = false;
    window.clearTimeout(timer);
    el.textContent = label;
    el.classList.remove('is-armed');
  }
  return el;
}

let fieldId = 0;

interface FieldParts<T extends HTMLElement> {
  row: HTMLElement;
  input: T;
}

function field<T extends HTMLElement>(label: string, input: T, hint?: string): FieldParts<T> {
  const id = `field-${++fieldId}`;
  input.id = id;
  const row = h(
    'div',
    { class: 'field' },
    h('label', { class: 'field__label', text: label, attrs: { for: id } }),
    input,
    hint ? h('p', { class: 'field__hint', text: hint }) : null,
  );
  return { row, input };
}

export interface TextFieldOptions {
  value?: string;
  placeholder?: string;
  maxLength?: number;
  hint?: string;
  id?: string;
}

export function textField(
  label: string,
  options: TextFieldOptions = {},
): FieldParts<HTMLInputElement> {
  const input = h('input', {
    class: 'field__input',
    attrs: {
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.maxLength ? { maxlength: String(options.maxLength) } : {}),
      ...(options.id ? { 'data-testid': options.id } : {}),
    },
  });
  input.value = options.value ?? '';
  return field(label, input, options.hint);
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (value: number) => string;
  onChange(value: number): void;
}

export interface SliderParts {
  row: HTMLElement;
  set(value: number): void;
}

export function sliderField(label: string, options: SliderOptions): SliderParts {
  const format = options.format ?? ((v: number) => String(v));
  const output = h('output', { class: 'field__value', text: format(options.value) });
  const input = h('input', {
    class: 'field__range',
    attrs: {
      type: 'range',
      min: String(options.min),
      max: String(options.max),
      step: String(options.step),
    },
  });
  input.value = String(options.value);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    output.textContent = format(value);
    options.onChange(value);
  });
  const parts = field(label, input);
  parts.row.classList.add('field--inline');
  parts.row.append(output);
  return {
    row: parts.row,
    set(value) {
      input.value = String(value);
      output.textContent = format(value);
    },
  };
}

export interface ToggleParts {
  row: HTMLElement;
  set(value: boolean): void;
}

export function toggleField(
  label: string,
  value: boolean,
  onChange: (value: boolean) => void,
  hint?: string,
): ToggleParts {
  const input = h('input', { class: 'toggle__input', attrs: { type: 'checkbox', role: 'switch' } });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const id = `field-${++fieldId}`;
  input.id = id;
  const row = h(
    'div',
    { class: 'field field--inline' },
    h(
      'label',
      { class: 'field__label', attrs: { for: id } },
      label,
      hint ? h('span', { class: 'field__hint', text: hint }) : null,
    ),
    h('span', { class: 'toggle' }, input, h('span', { class: 'toggle__track' })),
  );
  return { row, set: (next) => (input.checked = next) };
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export interface SegmentedParts<T extends string> {
  row: HTMLElement;
  get(): T;
  set(value: T): void;
}

/** A radio group rendered as selectable cards or pills. */
export function segmented<T extends string>(
  label: string,
  options: readonly SegmentOption<T>[],
  value: T,
  onChange: (value: T) => void = () => undefined,
  cards = false,
): SegmentedParts<T> {
  let current = value;
  const buttons = new Map<T, HTMLButtonElement>();
  const group = h('div', {
    class: cards ? 'segmented segmented--cards' : 'segmented',
    attrs: { role: 'radiogroup', 'aria-label': label },
  });
  const refresh = (): void => {
    for (const [optionValue, el] of buttons) {
      const selected = optionValue === current;
      el.classList.toggle('is-selected', selected);
      el.setAttribute('aria-checked', String(selected));
    }
  };
  for (const option of options) {
    const el = h(
      'button',
      {
        class: 'segmented__option',
        attrs: { type: 'button', role: 'radio', 'data-value': option.value },
        on: {
          click: () => {
            if (current === option.value) return;
            current = option.value;
            refresh();
            onChange(current);
          },
        },
      },
      h('span', { class: 'segmented__label', text: option.label }),
      option.description
        ? h('span', { class: 'segmented__description', text: option.description })
        : null,
    );
    buttons.set(option.value, el);
    group.append(el);
  }
  refresh();
  const row = h(
    'div',
    { class: 'field' },
    h('span', { class: 'field__label', text: label }),
    group,
  );
  return {
    row,
    get: () => current,
    set(next) {
      current = next;
      refresh();
    },
  };
}
