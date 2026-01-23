import { useEffect, useState } from "react";
import { getDocumentTheme } from "../styles";
import { McpUiTheme } from "../types";

/**
 * React hook that provides the current document theme reactively.
 *
 * Uses a `MutationObserver` to watch for changes to the `data-theme` attribute
 * or `class` on `document.documentElement`. When the theme changes (e.g., from
 * host context updates), the hook automatically re-renders your component with
 * the new theme value.
 *
 * The `MutationObserver` is automatically disconnected when the component unmounts.
 *
 * @returns The current theme ("light" or "dark")
 *
 * @example Conditionally render based on theme
 * {@includeCode ./useDocumentTheme.examples.tsx#useDocumentTheme_conditionalRender}
 *
 * @example Use with theme-aware styling
 * {@includeCode ./useDocumentTheme.examples.tsx#useDocumentTheme_themedButton}
 *
 * @see {@link getDocumentTheme `getDocumentTheme`} for the underlying function
 * @see {@link applyDocumentTheme `applyDocumentTheme`} to set the theme
 */
export function useDocumentTheme(): McpUiTheme {
  const [theme, setTheme] = useState<McpUiTheme>(getDocumentTheme);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(getDocumentTheme());
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "class"],
      characterData: false,
      childList: false,
      subtree: false,
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}
