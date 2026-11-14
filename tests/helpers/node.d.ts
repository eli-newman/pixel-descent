/** The project has no @types/node. These are the Node APIs the tests use: reading source files, and unpacking PNGs. */
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}

declare module 'node:zlib' {
  export function inflateSync(data: Uint8Array): Uint8Array;
}
