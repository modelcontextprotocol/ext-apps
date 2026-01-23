import { McpUiStyles, McpUiTheme } from "./types";

/**
 * Get the current document theme from the root HTML element.
 *
 * Reads the theme from the `data-theme` attribute on `document.documentElement`.
 * Falls back to checking for a `dark` class for compatibility with Tailwind CSS
 * dark mode conventions.
 *
 * @returns The current theme ("light" or "dark")
 *
 * @example Check current theme
 * {@includeCode ./styles.examples.ts#getDocumentTheme_checkCurrent}
 *
 * @see {@link applyDocumentTheme `applyDocumentTheme`} to set the theme
 * @see {@link McpUiTheme `McpUiTheme`} for the theme type
 */
export function getDocumentTheme(): McpUiTheme {
  const theme = document.documentElement.getAttribute("data-theme");

  if (theme === "dark" || theme === "light") {
    return theme;
  }

  // Fallback: check for "dark" class (Tailwind CSS convention)
  const darkMode = document.documentElement.classList.contains("dark");

  return darkMode ? "dark" : "light";
}

/**
 * Apply a theme to the document root element.
 *
 * Sets the `data-theme` attribute and CSS `color-scheme` property on
 * `document.documentElement`. This enables CSS selectors like
 * `[data-theme="dark"]` and ensures native elements (scrollbars, form controls)
 * respect the theme.
 *
 * @param theme - The theme to apply ("light" or "dark")
 *
 * @example Apply theme from host context
 * {@includeCode ./styles.examples.ts#applyDocumentTheme_fromHostContext}
 *
 * @example Use with CSS selectors
 * ```css
 * [data-theme="dark"] {
 *   --bg-color: #1a1a1a;
 * }
 * [data-theme="light"] {
 *   --bg-color: #ffffff;
 * }
 * ```
 *
 * @see {@link getDocumentTheme `getDocumentTheme`} to read the current theme
 * @see {@link McpUiTheme `McpUiTheme`} for the theme type
 */
export function applyDocumentTheme(theme: McpUiTheme): void {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.style.colorScheme = theme;
}

/**
 * Apply host style variables as CSS custom properties on an element.
 *
 * This function takes the `variables` object from {@link McpUiHostContext.styles `McpUiHostContext.styles`} and sets
 * each CSS variable on the specified root element (defaults to `document.documentElement`).
 * This allows apps to use the host's theming values via CSS variables like
 * `var(--color-background-primary)`.
 *
 * @param styles - The style variables object from `McpUiHostContext.styles.variables`
 * @param root - The element to apply styles to (defaults to `document.documentElement`)
 *
 * @example Apply style variables from host context
 * {@includeCode ./styles.examples.ts#applyHostStyleVariables_fromHostContext}
 *
 * @example Apply to a specific element
 * {@includeCode ./styles.examples.ts#applyHostStyleVariables_toElement}
 *
 * @example Use host style variables in CSS
 * ```css
 * body {
 *   background-color: var(--color-background-primary);
 *   color: var(--color-text-primary);
 * }
 *
 * .card {
 *   background-color: var(--color-background-secondary);
 *   border: 1px solid var(--color-border-primary);
 * }
 * ```
 *
 * @see {@link McpUiStyles `McpUiStyles`} for the available CSS variables
 * @see {@link McpUiHostContext `McpUiHostContext`} for the full host context structure
 */
export function applyHostStyleVariables(
  styles: McpUiStyles,
  root: HTMLElement = document.documentElement,
): void {
  for (const [key, value] of Object.entries(styles)) {
    if (value !== undefined) {
      root.style.setProperty(key, value);
    }
  }
}

/**
 * Apply host font CSS to the document.
 *
 * This function takes the `css.fonts` string from `McpUiHostContext.styles` and
 * injects it as a `<style>` tag. The CSS can contain `@font-face` rules for
 * self-hosted fonts, `@import` statements for Google Fonts or other font services,
 * or a combination of both.
 *
 * The styles are only injected once. Subsequent calls are no-ops and will not
 * create duplicate style tags.
 *
 * @param fontCss - CSS string containing `@font-face` rules and/or `@import` statements
 *
 * @example Apply fonts from host context
 * {@includeCode ./styles.examples.ts#applyHostFonts_fromHostContext}
 *
 * @example Host providing self-hosted fonts
 * {@includeCode ./styles.examples.ts#applyHostFonts_selfHosted}
 *
 * @example Host providing Google Fonts
 * {@includeCode ./styles.examples.ts#applyHostFonts_googleFonts}
 *
 * @example Use host fonts in CSS
 * ```css
 * body {
 *   font-family: var(--font-sans, system-ui, sans-serif);
 * }
 * ```
 *
 * @see {@link McpUiHostContext `McpUiHostContext`} for the full host context structure
 */
export function applyHostFonts(fontCss: string): void {
  const styleId = "__mcp-host-fonts";

  // Check if already loaded
  if (document.getElementById(styleId)) {
    return;
  }

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = fontCss;
  document.head.appendChild(style);
}
