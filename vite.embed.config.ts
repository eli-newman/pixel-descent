import ts from 'typescript';
import { defineConfig, type Plugin } from 'vite';

/**
 * The embed library build (`npm run build:embed`): one dependency-free ES module and one self-contained
 * declaration file in `dist-embed/`, for another site to vendor by copying. See `src/embed/CLAUDE.md`.
 */
const ENTRY = decodeURIComponent(new URL('./src/embed/index.ts', import.meta.url).pathname);
const NAME = 'powline-embed';

/**
 * Emit the entry's declarations with the TypeScript compiler. Every public type lives in the entry, so its .d.ts
 * stands alone: the build fails if it would import anything, rather than shipping a file that cannot resolve.
 */
function declarations(): Plugin {
  return {
    name: 'powline-embed-dts',
    apply: 'build',
    generateBundle() {
      const program = ts.createProgram([ENTRY], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        declaration: true,
        emitDeclarationOnly: true,
        skipLibCheck: true,
        types: [],
        lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
      });
      const errors = ts.getPreEmitDiagnostics(program);
      if (errors.length > 0) {
        this.error(ts.formatDiagnostics(errors, ts.createCompilerHost({})));
      }
      let dts = '';
      program.emit(
        program.getSourceFile(ENTRY),
        (file, text) => {
          if (file.endsWith('/embed/index.d.ts')) dts = text;
        },
        undefined,
        true,
      );
      if (!dts) this.error('no declarations were emitted for the entry');
      if (/^\s*(import|export\s.*\sfrom)\s/m.test(dts)) {
        this.error(`the public API must not mention types from other files:\n${dts}`);
      }
      this.emitFile({ type: 'asset', fileName: `${NAME}.d.ts`, source: dts });
    },
  };
}

export default defineConfig({
  publicDir: false,
  plugins: [declarations()],
  build: {
    target: 'es2022',
    outDir: 'dist-embed',
    emptyOutDir: true,
    minify: true,
    lib: { entry: ENTRY, formats: ['es'], fileName: () => `${NAME}.js` },
  },
});
