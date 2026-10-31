import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

/** Layer rules: see the root CLAUDE.md. Each entry bans imports from a folder; `types` only bans value imports. */
const MAIN = { group: ['**/main'], message: 'Nothing imports the entry point.' };

function boundaries(files, patterns) {
  return {
    files,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns: [MAIN, ...patterns] }],
    },
  };
}

function banned(folder, why) {
  return { group: [`**/${folder}/*`], message: why };
}

function typesOnly(folder, why) {
  return { ...banned(folder, why), allowTypeImports: true };
}

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  boundaries(
    ['src/core/**/*.ts'],
    ['sim', 'state', 'platform', 'render'].map((f) => banned(f, 'core imports nothing.')),
  ),
  boundaries(
    ['src/sim/**/*.ts'],
    ['state', 'platform', 'render'].map((f) => banned(f, 'sim imports core only.')),
  ),
  boundaries(
    ['src/state/**/*.ts'],
    ['platform', 'render'].map((f) =>
      typesOnly(f, 'state gets browser and drawing code through GameDeps: types only.'),
    ),
  ),
  boundaries(
    ['src/platform/**/*.ts'],
    [
      banned('sim', 'platform imports core and the share card only.'),
      banned('state', 'platform imports core and the share card only.'),
      {
        group: ['**/render/*', '!**/render/share', '!**/render/framebuffer'],
        message: 'platform imports core and the share card only.',
      },
    ],
  ),
  boundaries(
    ['src/render/**/*.ts'],
    [
      banned('platform', 'render reads state, it does not talk to the browser.'),
      {
        group: ['**/state/game', '**/sim/sim'],
        message: 'render sees the game through state/view (GameView, SimView), which cannot write.',
      },
    ],
  ),
  {
    files: ['src/render/**/*.ts'],
    rules: {
      // No way to turn view data back into something writable: no casts, no `!`, no ts-comments.
      'no-restricted-syntax': [
        'error',
        {
          selector: "TSAsExpression:not([typeAnnotation.typeName.name='const'])",
          message: 'render reads state through read-only types: no `as` casts.',
        },
        {
          selector: 'TSTypeAssertion',
          message: 'render reads state through read-only types: no type assertions.',
        },
        {
          selector: 'TSNonNullExpression',
          message: 'render reads state through read-only types: no non-null assertions.',
        },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-expect-error': true,
          'ts-ignore': true,
          'ts-nocheck': true,
          'ts-check': false,
        },
      ],
      // TypeScript lets a readonly value reach a mutable parameter, so every parameter in render must be readonly. Drawing targets are the exception.
      '@typescript-eslint/prefer-readonly-parameter-types': [
        'error',
        {
          allow: [
            { from: 'file', name: 'Framebuffer', path: 'src/render/framebuffer.ts' },
            { from: 'file', name: 'Mask', path: 'src/render/riderSprite.ts' },
            { from: 'file', name: 'Rng', path: 'src/core/rng.ts' },
          ],
          ignoreInferredTypes: true,
          treatMethodsAsReadonly: true,
        },
      ],
    },
  },
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: { globals: globals.node },
  },
  prettier,
);
