/**
 * Type-checked examples for style utilities in {@link ./styles.ts `styles.ts`}.
 *
 * These examples are included in the API documentation via `@includeCode` tags.
 * Each function's region markers define the code snippet that appears in the docs.
 *
 * @module
 */

import { App } from "./app.js";
import {
  getDocumentTheme,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from "./styles.js";

/**
 * Example: Check current theme.
 */
function getDocumentTheme_checkCurrent() {
  //#region getDocumentTheme_checkCurrent
  const theme = getDocumentTheme();
  document.body.classList.toggle("dark", theme === "dark");
  //#endregion getDocumentTheme_checkCurrent
}

/**
 * Example: Apply theme from host context.
 */
function applyDocumentTheme_fromHostContext(app: App) {
  //#region applyDocumentTheme_fromHostContext
  // Apply when host context changes
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) {
      applyDocumentTheme(ctx.theme);
    }
  };

  // Apply initial theme after connecting
  app.connect().then(() => {
    const ctx = app.getHostContext();
    if (ctx?.theme) {
      applyDocumentTheme(ctx.theme);
    }
  });
  //#endregion applyDocumentTheme_fromHostContext
}

/**
 * Example: Apply style variables from host context.
 */
function applyHostStyleVariables_fromHostContext(app: App) {
  //#region applyHostStyleVariables_fromHostContext
  // Use CSS variables in your styles
  document.body.style.background = "var(--color-background-primary)";

  // Apply when host context changes
  app.onhostcontextchanged = (ctx) => {
    if (ctx.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables);
    }
  };

  // Apply initial styles after connecting
  app.connect().then(() => {
    const ctx = app.getHostContext();
    if (ctx?.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables);
    }
  });
  //#endregion applyHostStyleVariables_fromHostContext
}

/**
 * Example: Apply to a specific element.
 */
function applyHostStyleVariables_toElement(app: App) {
  //#region applyHostStyleVariables_toElement
  app.onhostcontextchanged = (ctx) => {
    const container = document.getElementById("app-root");
    if (container && ctx.styles?.variables) {
      applyHostStyleVariables(ctx.styles.variables, container);
    }
  };
  //#endregion applyHostStyleVariables_toElement
}

/**
 * Example: Apply fonts from host context.
 */
function applyHostFonts_fromHostContext(app: App) {
  //#region applyHostFonts_fromHostContext
  // Apply when host context changes
  app.onhostcontextchanged = (ctx) => {
    if (ctx.styles?.css?.fonts) {
      applyHostFonts(ctx.styles.css.fonts);
    }
  };

  // Apply initial fonts after connecting
  app.connect().then(() => {
    const ctx = app.getHostContext();
    if (ctx?.styles?.css?.fonts) {
      applyHostFonts(ctx.styles.css.fonts);
    }
  });
  //#endregion applyHostFonts_fromHostContext
}

/**
 * Example: Host providing self-hosted fonts.
 */
function applyHostFonts_selfHosted() {
  //#region applyHostFonts_selfHosted
  // Example of what a host might provide:
  const fontCss = `
    @font-face {
      font-family: "Anthropic Sans";
      src: url("https://assets.anthropic.com/.../Regular.otf") format("opentype");
      font-weight: 400;
    }
  `;
  applyHostFonts(fontCss);
  //#endregion applyHostFonts_selfHosted
}

/**
 * Example: Host providing Google Fonts.
 */
function applyHostFonts_googleFonts() {
  //#region applyHostFonts_googleFonts
  // Example of what a host might provide:
  const fontCss = `
    @import url('https://fonts.googleapis.com/css2?family=Roboto&display=swap');
  `;
  applyHostFonts(fontCss);
  //#endregion applyHostFonts_googleFonts
}
