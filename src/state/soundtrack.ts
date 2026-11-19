import type { Scene } from '../core/soundtrack';
import type { Phase } from './menu';

/** The soundtrack's scene for a game phase: the title, menus and game over are the lobby; a fall is silence. */
export function sceneFor(phase: Phase): Scene {
  switch (phase) {
    case 'playing':
      return 'run';
    case 'paused':
      return 'pause';
    case 'crashed':
      return 'down';
    case 'title':
    case 'over':
      return 'lobby';
  }
}
