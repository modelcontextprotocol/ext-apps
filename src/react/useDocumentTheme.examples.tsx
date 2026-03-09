/**
 * Type-checked examples for the useDocumentTheme hook.
 *
 * @module
 */

import { useDocumentTheme } from "./useDocumentTheme.js";

// Stub components for examples
declare function DarkIcon(): React.JSX.Element;
declare function LightIcon(): React.JSX.Element;

/**
 * Example: Conditionally render based on theme.
 */
function useDocumentTheme_conditionalRender() {
  //#region useDocumentTheme_conditionalRender
  function MyApp() {
    const theme = useDocumentTheme();

    return <div>{theme === "dark" ? <DarkIcon /> : <LightIcon />}</div>;
  }
  //#endregion useDocumentTheme_conditionalRender
}

/**
 * Example: Use with theme-aware styling.
 */
function useDocumentTheme_themedButton() {
  //#region useDocumentTheme_themedButton
  function ThemedButton() {
    const theme = useDocumentTheme();

    return (
      <button
        style={{
          background: theme === "dark" ? "#333" : "#fff",
          color: theme === "dark" ? "#fff" : "#333",
        }}
      >
        Click me
      </button>
    );
  }
  //#endregion useDocumentTheme_themedButton
}
