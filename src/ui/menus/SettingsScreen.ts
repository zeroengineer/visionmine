import type { QualityTier } from '@/core/renderer/quality';
import { SETTING_LIMITS, settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import { button, segmented, sliderField, toggleField } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';
import { createBindingsEditor } from './BindingsEditor';

type Tab = 'graphics' | 'controls' | 'world';
const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: 'graphics', label: 'Graphics' },
  { id: 'controls', label: 'Controls' },
  { id: 'world', label: 'World & sound' },
];

export function createSettingsScreen(): View {
  const store = settingsStore;
  const s = store.getState();
  const set = store.getState().set;
  const L = SETTING_LIMITS;

  const quality = segmented<QualityTier>(
    'Graphics preset',
    [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
    s.quality,
    (value) => store.getState().applyQualityPreset(value),
  );
  const renderDistance = sliderField('Render distance', {
    ...L.renderDistance,
    step: 1,
    value: s.renderDistance,
    format: (v) => `${v} chunks`,
    onChange: (renderDistance) => set({ renderDistance }),
  });
  const shadows = toggleField('Shadows', s.shadows, (shadows) => set({ shadows }));
  const adaptive = toggleField(
    'Adaptive resolution',
    s.adaptiveQuality,
    (adaptiveQuality) => set({ adaptiveQuality }),
    'Lowers resolution automatically when the frame rate drops.',
  );
  const weather = toggleField('Weather', s.weather, (weather) => set({ weather }));
  const fov = sliderField('Field of view', {
    ...L.fov,
    step: 1,
    value: s.fov,
    format: (v) => `${v}°`,
    onChange: (fov) => set({ fov }),
  });
  const sensitivity = sliderField('Mouse sensitivity', {
    ...L.sensitivity,
    step: 0.05,
    value: s.sensitivity,
    format: (v) => `${v.toFixed(2)}×`,
    onChange: (sensitivity) => set({ sensitivity }),
  });
  const invertY = toggleField('Invert vertical look', s.invertY, (invertY) => set({ invertY }));
  const autoJump = toggleField(
    'Auto-jump',
    s.autoJump,
    (autoJump) => set({ autoJump }),
    'Climb one-block ledges without pressing jump.',
  );
  const sprintToggle = toggleField(
    'Toggle sprint',
    s.sprintToggle,
    (sprintToggle) => set({ sprintToggle }),
    'Press the sprint key once instead of holding it.',
  );
  const dayLength = sliderField('Day length', {
    ...L.dayLengthMinutes,
    step: 1,
    value: s.dayLengthMinutes,
    format: (v) => `${v} min`,
    onChange: (dayLengthMinutes) => set({ dayLengthMinutes }),
  });
  const volume = sliderField('Sound volume', {
    min: 0,
    max: 1,
    step: 0.05,
    value: s.volume,
    format: (v) => `${Math.round(v * 100)}%`,
    onChange: (volume) => set({ volume }),
  });
  const debug = toggleField(
    'Debug overlay',
    s.showDebug,
    (showDebug) => set({ showDebug }),
    'Also toggled with its key (F3 by default).',
  );
  const bindings = createBindingsEditor();

  const sync = (): void => {
    const state = store.getState();
    quality.set(state.quality);
    renderDistance.set(state.renderDistance);
    shadows.set(state.shadows);
    adaptive.set(state.adaptiveQuality);
    weather.set(state.weather);
    fov.set(state.fov);
    sensitivity.set(state.sensitivity);
    invertY.set(state.invertY);
    autoJump.set(state.autoJump);
    sprintToggle.set(state.sprintToggle);
    dayLength.set(state.dayLengthMinutes);
    volume.set(state.volume);
    debug.set(state.showDebug);
  };

  const done = button('Done', () => uiStore.getState().back(), { id: 'settings-done' });
  done.setAttribute('data-autofocus', '');
  const defaults = button('Restore defaults', () => store.getState().reset(), { variant: 'ghost' });

  // One tab is shown at a time; each is a tabpanel labelled by its tab button.
  const panels: Record<Tab, HTMLElement> = {
    graphics: h(
      'div',
      { class: 'settings__panel' },
      quality.row,
      renderDistance.row,
      shadows.row,
      adaptive.row,
      weather.row,
    ),
    controls: h(
      'div',
      { class: 'settings__panel' },
      h(
        'div',
        { class: 'settings__mouse' },
        fov.row,
        sensitivity.row,
        invertY.row,
        autoJump.row,
        sprintToggle.row,
      ),
      bindings.el,
    ),
    world: h('div', { class: 'settings__panel' }, dayLength.row, volume.row, debug.row),
  };
  const tabButtons = new Map<Tab, HTMLButtonElement>();
  const selectTab = (tab: Tab): void => {
    for (const { id } of TABS) {
      const selected = id === tab;
      panels[id].hidden = !selected;
      const tabButton = tabButtons.get(id)!;
      tabButton.classList.toggle('is-selected', selected);
      tabButton.setAttribute('aria-selected', String(selected));
      tabButton.tabIndex = selected ? 0 : -1;
    }
  };
  const tabList = h('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Settings' } });
  for (const { id, label } of TABS) {
    const tabButton = h('button', {
      class: 'tabs__tab',
      text: label,
      attrs: {
        type: 'button',
        role: 'tab',
        id: `settings-tab-${id}`,
        'aria-controls': `settings-panel-${id}`,
      },
      on: { click: () => selectTab(id) },
    });
    tabButtons.set(id, tabButton);
    tabList.append(tabButton);
    panels[id].id = `settings-panel-${id}`;
    panels[id].setAttribute('role', 'tabpanel');
    panels[id].setAttribute('aria-labelledby', tabButton.id);
  }
  tabList.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const ids = TABS.map((tab) => tab.id);
    const current = ids.findIndex((id) => tabButtons.get(id)!.classList.contains('is-selected'));
    const next = ids[(current + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length]!;
    selectTab(next);
    tabButtons.get(next)!.focus();
  });
  selectTab('graphics');

  const panel = h(
    'div',
    { class: 'panel panel--wide settings', attrs: { role: 'dialog', 'aria-label': 'Settings' } },
    h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', text: 'Settings' })),
    tabList,
    panels.graphics,
    panels.controls,
    panels.world,
    h('footer', { class: 'panel__footer' }, defaults, done),
  );
  const el = h(
    'div',
    { class: 'overlay overlay--dim', attrs: { 'data-screen': 'settings' } },
    panel,
  );

  const unsubscribers = [bindScreen(el, ['settings'], sync), store.subscribe(sync)];
  return {
    el,
    dispose() {
      for (const unsubscribe of unsubscribers) unsubscribe();
      bindings.dispose();
      el.remove();
    },
  };
}
