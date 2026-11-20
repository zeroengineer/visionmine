import type { QualityTier } from '@/core/renderer/quality';
import { SETTING_LIMITS, settingsStore } from '@/state/settingsStore';
import { uiStore } from '@/state/uiStore';
import { button, segmented, sliderField, toggleField } from '../components/controls';
import { h, type View } from '../components/dom';
import { bindScreen } from '../components/screen';

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
    'Also toggled with F3.',
  );

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
    dayLength.set(state.dayLengthMinutes);
    volume.set(state.volume);
    debug.set(state.showDebug);
  };

  const done = button('Done', () => uiStore.getState().back(), { id: 'settings-done' });
  done.setAttribute('data-autofocus', '');
  const defaults = button('Restore defaults', () => store.getState().reset(), { variant: 'ghost' });

  const section = (title: string, ...rows: HTMLElement[]): HTMLElement =>
    h(
      'section',
      { class: 'settings__section' },
      h('h3', { class: 'inv__heading', text: title }),
      ...rows,
    );

  const panel = h(
    'div',
    { class: 'panel panel--wide settings', attrs: { role: 'dialog', 'aria-label': 'Settings' } },
    h('header', { class: 'panel__header' }, h('h2', { class: 'panel__title', text: 'Settings' })),
    h(
      'div',
      { class: 'settings__grid' },
      section('Graphics', quality.row, renderDistance.row, shadows.row, adaptive.row, weather.row),
      section('Controls', fov.row, sensitivity.row, invertY.row),
      section('World & sound', dayLength.row, volume.row, debug.row),
    ),
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
      el.remove();
    },
  };
}
