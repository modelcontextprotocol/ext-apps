/**
 * Stub polyfills for pdfjs-dist's legacy build under Node.js.
 *
 * pdfjs-dist/legacy/build/pdf.mjs eagerly does `new DOMMatrix()` at module
 * scope. Its own polyfill loads `@napi-rs/canvas` (an optionalDependency),
 * but `npx` / fresh installs frequently miss the platform-native binary
 * (npm optional-deps bug, see https://github.com/npm/cli/issues/4828),
 * so the import crashes before our server code runs.
 *
 * The server only uses pdfjs for text/metadata/form-field extraction —
 * never canvas rendering — so no-op stubs are sufficient and avoid
 * shipping ~130MB of native binaries we don't need.
 *
 * MUST be a separate ESM module imported before pdfjs-dist (and kept
 * `--external` in the bun bundle) so it executes before pdfjs's
 * module-level initializer. Inlined body code would run too late
 * because static imports are hoisted.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

// Only stub if missing — let a real @napi-rs/canvas (or jsdom) win.
g.DOMMatrix ??= class DOMMatrix {};
g.ImageData ??= class ImageData {};
g.Path2D ??= class Path2D {};
