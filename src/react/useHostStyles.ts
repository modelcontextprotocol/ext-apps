import { useEffect, useRef } from "react";
import { App } from "../app";
import {
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
} from "../styles";
import { McpUiHostContext } from "../types";

/**
 * React hook that applies host style variables and theme as CSS custom properties.
 *
 * This hook listens to host context changes and automatically applies:
 * - `styles.variables` CSS variables to `document.documentElement` (e.g., `--color-background-primary`)
 * - `theme` via `color-scheme` CSS property, enabling `light-dark()` CSS function support
 *
 * The hook also applies styles and theme from the initial host context when
 * the app first connects.
 *
 * **Note:** If the host provides style values using CSS `light-dark()` function,
 * this hook ensures they work correctly by setting the `color-scheme` property
 * based on the host's theme preference.
 *
 * @param app - The connected {@link App `App`} instance, or null during initialization
 * @param initialContext - Initial host context from the connection (optional).
 *   If provided, styles and theme will be applied immediately on mount.
 *
 * @example
 * {@includeCode ./useHostStyles.examples.tsx#useHostStyleVariables_basicUsage}
 *
 * @see {@link applyHostStyleVariables `applyHostStyleVariables`} for the underlying styles function
 * @see {@link applyDocumentTheme `applyDocumentTheme`} for the underlying theme function
 * @see {@link useHostFonts `useHostFonts`} for applying host fonts
 * @see {@link McpUiStyles `McpUiStyles`} for available CSS variables
 */
export function useHostStyleVariables(
  app: App | null,
  initialContext?: McpUiHostContext | null,
): void {
  const initialApplied = useRef(false);

  // Apply initial styles and theme once on mount
  useEffect(() => {
    if (initialApplied.current) {
      return;
    }
    if (initialContext?.theme) {
      applyDocumentTheme(initialContext.theme);
    }
    if (initialContext?.styles?.variables) {
      applyHostStyleVariables(initialContext.styles.variables);
    }
    if (initialContext?.theme || initialContext?.styles?.variables) {
      initialApplied.current = true;
    }
  }, [initialContext]);

  // Listen for host context changes and apply updated styles/theme
  useEffect(() => {
    if (!app) {
      return;
    }

    app.onhostcontextchanged = (params) => {
      if (params.theme) {
        applyDocumentTheme(params.theme);
      }
      if (params.styles?.variables) {
        applyHostStyleVariables(params.styles.variables);
      }
    };
  }, [app]);
}

/**
 * React hook that applies host fonts from CSS.
 *
 * This hook listens to host context changes and automatically applies:
 * - `styles.css.fonts` as a `<style>` tag for custom fonts
 *
 * The CSS can contain `@font-face` rules for self-hosted fonts,
 * `@import` statements for Google Fonts or other font services, or both.
 *
 * The hook also applies fonts from the initial host context when
 * the app first connects.
 *
 * @param app - The connected {@link App `App`} instance, or null during initialization
 * @param initialContext - Initial host context from the connection (optional).
 *   If provided, fonts will be applied immediately on mount.
 *
 * @example Basic usage with useApp
 * {@includeCode ./useHostStyles.examples.tsx#useHostFonts_basicUsage}
 *
 * @see {@link applyHostFonts `applyHostFonts`} for the underlying fonts function
 * @see {@link useHostStyleVariables `useHostStyleVariables`} for applying style variables and theme
 */
export function useHostFonts(
  app: App | null,
  initialContext?: McpUiHostContext | null,
): void {
  const initialApplied = useRef(false);

  // Apply initial fonts once on mount
  useEffect(() => {
    if (initialApplied.current) {
      return;
    }
    if (initialContext?.styles?.css?.fonts) {
      applyHostFonts(initialContext.styles.css.fonts);
      initialApplied.current = true;
    }
  }, [initialContext]);

  // Listen for host context changes and apply updated fonts
  useEffect(() => {
    if (!app) {
      return;
    }

    app.onhostcontextchanged = (params) => {
      if (params.styles?.css?.fonts) {
        applyHostFonts(params.styles.css.fonts);
      }
    };
  }, [app]);
}

/**
 * Applies all host styling (CSS variables, theme, and fonts) to match the host application.
 *
 * This is a convenience hook that combines {@link useHostStyleVariables `useHostStyleVariables`} and
 * {@link useHostFonts `useHostFonts`}. Use the individual hooks if you need more control.
 *
 * @param app - The connected {@link App `App`} instance, or null during initialization
 * @param initialContext - Initial host context from the connection (optional).
 *   Pass `app?.getHostContext()` to apply styles immediately on mount.
 *
 * @example
 * {@includeCode ./useHostStyles.examples.tsx#useHostStyles_basicUsage}
 *
 * @see {@link useHostStyleVariables `useHostStyleVariables`} for style variables and theme only
 * @see {@link useHostFonts `useHostFonts`} for fonts only
 */
export function useHostStyles(
  app: App | null,
  initialContext?: McpUiHostContext | null,
): void {
  useHostStyleVariables(app, initialContext);
  useHostFonts(app, initialContext);
}
