# src

Source root. `main.ts` is the only entry (loaded by `index.html`), `style.css` styles the page around the canvas.

See the root `CLAUDE.md` for the layer diagram and dependency rules, and each subfolder's `CLAUDE.md` for its files.

| Path                                          | Job                                                                                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `main.ts`                                     | Builds `Store`, `Sfx`, `Input`, `Game`, `Framebuffer`, `SceneRenderer`, `Loop` once; wires resize, pause button, auto-pause; exposes `__game`, `__input`, `__store` in dev only. |
| `style.css`                                   | Page layout, pause button, safe-area probe.                                                                                                                                      |
| `core/` `sim/` `state/` `platform/` `render/` | See their own `CLAUDE.md`.                                                                                                                                                       |

## Keeping docs in sync (mandatory)

When you change `main.ts` wiring or add a folder here, update this file and the root `CLAUDE.md` in the same change.
