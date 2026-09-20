import { defineConfig } from 'tsdown'

/**
 * Self-contained build for the published bundle: transpile src/ to ESM under
 * lib/ without project references (the reference pattern for out-of-tree dsh
 * bundles). Peer packages stay external.
 *
 * The second config emits the browser client bundle (lib/client.js) from
 * src/client/index.ts. The host's client-modules scanner loads any bundle
 * that declares `dsh.client` + `exports["./client"]`; the artifact must call
 * `window.__ModuleLoader__.load({ id, factory })` — the same handoff shape the
 * harness's own client packages emit.
 */
const lib = defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'lib',
  clean: true,
  sourcemap: true,
  dts: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      '@deepseek-ai/schemastery',
      '@deepseek-ai/dsh-agent',
      '@deepseek-ai/dsh-llm',
      '@deepseek-ai/dsh-permission-presets',
      '@deepseek-ai/dsh-typert-protocol',
    ],
  },
})

const client = defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
  // Only platform/seed modules and host-shipped client bundles are resolvable
  // from the loader's module table at runtime; anything else must stay
  // external (a cross-plugin value import would be a build error upstream).
  deps: {
    neverBundle: [
      '@deepseek-ai/cordis',
      'react',
      'react/jsx-runtime',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('dsh-auto-review-jev')}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

export default [lib, client]
