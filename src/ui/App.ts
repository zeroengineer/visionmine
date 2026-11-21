import type { TileAtlas } from '@/rendering/textures/TileAtlas';
import { initBlockIcons } from './components/blockIcon';
import type { View } from './components/dom';
import type { GameCommands } from './GameCommands';
import { createHud } from './hud/Hud';
import { createToasts } from './hud/Toasts';
import { createInventoryScreen } from './inventory/InventoryScreen';
import { createBuildMenu } from './menus/BuildMenu';
import { createPauseMenu } from './menus/PauseMenu';
import { createSettingsScreen } from './menus/SettingsScreen';
import { createCreateWorldScreen } from './screens/CreateWorldScreen';
import { createLoadingScreen } from './screens/LoadingScreen';
import { createMainMenu } from './screens/MainMenu';
import { createWorldsScreen } from './screens/WorldsScreen';

/**
 * Builds the whole interface once and mounts it. Each view shows or hides
 * itself by subscribing to the UI store; nothing here runs per frame.
 */
export function mountUi(root: HTMLElement, commands: GameCommands, atlas: TileAtlas): View {
  initBlockIcons(atlas);
  const views: View[] = [
    createHud(commands),
    createMainMenu(commands),
    createCreateWorldScreen(commands),
    createWorldsScreen(commands),
    createLoadingScreen(),
    createInventoryScreen({ onClose: () => commands.closeInventory() }),
    createBuildMenu(commands),
    createPauseMenu(commands),
    createSettingsScreen(),
    createToasts(),
  ];
  root.replaceChildren(...views.map((view) => view.el));
  return {
    el: root,
    dispose() {
      for (const view of views) view.dispose();
    },
  };
}
