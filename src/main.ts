import './styles/base.css';

/**
 * Application entry point. The engine, world and UI systems are attached here as
 * they are introduced; see ARCHITECTURE.md for the module map.
 */
function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const ui = document.querySelector<HTMLDivElement>('#ui');
  if (!canvas || !ui) throw new Error('VISIONMINE: required root elements are missing.');
  document.documentElement.dataset.app = 'visionmine';
}

boot();
