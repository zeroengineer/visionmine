import './styles/base.css';
import './styles/hud.css';
import './styles/menus.css';
import { installDebugHook, shouldInstallDebugHook } from '@/game/debugHook';
import { Game } from '@/game/Game';
import { mountUi } from '@/ui/App';

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

  let game: Game;
  try {
    game = new Game(canvas);
  } catch (error) {
    console.error(error);
    showFatalError(
      ui,
      'Your browser or graphics driver does not appear to support WebGL 2. ' +
        'Try updating your browser or enabling hardware acceleration.',
    );
    return;
  }

  mountUi(ui, game, game.atlas);
  if (shouldInstallDebugHook()) installDebugHook(game);
  game.start();
  game.boot().catch((error: unknown) => {
    console.error('VISIONMINE: boot failed.', error);
    showFatalError(ui, 'The game failed to initialise. Reload the page to try again.');
  });
}

boot();
