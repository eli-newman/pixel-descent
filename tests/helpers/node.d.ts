/** The project has no @types/node. These are the Node APIs the tests use: reading source files, checking the music files, and unpacking PNGs. */
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
  export function existsSync(path: URL): boolean;
  export function statSync(path: URL): { size: number };
}

declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
