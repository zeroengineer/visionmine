import './styles/base.css';
import { Game } from '@/game/Game';
import { createCrosshair } from '@/ui/hud/Crosshair';

function showFatalError(root: HTMLElement, message: string): void {
  const box = document.createElement('div');
  box.className = 'fatal-error';
  box.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = 'VISIONMINE could not start';
  const body = document.createElement('p');
  body.textContent = message;
  box.append(title, body);
  root.replaceChildren(box);
}

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const ui = document.querySelector<HTMLDivElement>('#ui');
  if (!canvas || !ui) throw new Error('VISIONMINE: required root elements are missing.');

  try {
    const game = new Game(canvas);
    game.start();
    ui.append(createCrosshair());
  } catch (error) {
    console.error(error);
    showFatalError(
      ui,
      'Your browser or graphics driver does not appear to support WebGL 2. ' +
        'Try updating your browser or enabling hardware acceleration.',
    );
  }
}

boot();
