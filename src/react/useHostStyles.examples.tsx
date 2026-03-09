/**
 * Type-checked examples for the useHostStyles hooks.
 *
 * @module
 */

import {
  useApp,
  useHostStyleVariables,
  useHostFonts,
  useHostStyles,
} from "./index.js";

/**
 * Example: Basic usage of useHostStyleVariables.
 */
function useHostStyleVariables_basicUsage() {
  //#region useHostStyleVariables_basicUsage
  function MyApp() {
    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    // Apply host styles - pass initial context to apply styles from connect() immediately
    useHostStyleVariables(app, app?.getHostContext());

    return (
      <div style={{ background: "var(--color-background-primary)" }}>
        Hello!
      </div>
    );
  }
  //#endregion useHostStyleVariables_basicUsage
}

/**
 * Example: Basic usage of useHostFonts with useApp.
 */
function useHostFonts_basicUsage() {
  //#region useHostFonts_basicUsage
  function MyApp() {
    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    // Apply host fonts - pass initial context to apply fonts from connect() immediately
    useHostFonts(app, app?.getHostContext());

    return <div style={{ fontFamily: "var(--font-sans)" }}>Hello!</div>;
  }
  //#endregion useHostFonts_basicUsage
}

/**
 * Example: Basic usage of useHostStyles.
 */
function useHostStyles_basicUsage() {
  //#region useHostStyles_basicUsage
  function MyApp() {
    const { app } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    // Apply all host styles - pass initial context to apply styles from connect() immediately
    useHostStyles(app, app?.getHostContext());

    return (
      <div style={{ background: "var(--color-background-primary)" }}>
        Hello!
      </div>
    );
  }
  //#endregion useHostStyles_basicUsage
}
