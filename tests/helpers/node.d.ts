/** The project has no @types/node. This is the one Node API the tests use, to read source files as text. */
declare module 'node:fs' {
  export function readFileSync(path: URL, encoding: 'utf8'): string;
}
