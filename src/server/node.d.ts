/** The project has no @types/node. These are the only Node APIs the server code uses. */
declare module 'node:zlib' {
  export function deflateSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
}
