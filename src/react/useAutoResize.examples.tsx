/**
 * Type-checked examples for the useAutoResize hook.
 *
 * @module
 */

import { useState, useEffect } from "react";
import { App, PostMessageTransport } from "./index.js";
import { useAutoResize } from "./useAutoResize.js";

/**
 * Example: Manual App creation with custom auto-resize control.
 */
function useAutoResize_manualApp() {
  //#region useAutoResize_manualApp
  function MyComponent() {
    // For custom App options, create App manually instead of using useApp
    const [app, setApp] = useState<App | null>(null);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
      const myApp = new App(
        { name: "MyApp", version: "1.0.0" },
        {}, // capabilities
        { autoResize: false }, // Disable default auto-resize
      );

      const transport = new PostMessageTransport(window.parent, window.parent);
      myApp
        .connect(transport)
        .then(() => setApp(myApp))
        .catch((err) => setError(err));
    }, []);

    // Add manual auto-resize control
    useAutoResize(app);

    if (error) return <div>Connection failed: {error.message}</div>;
    return <div>My content</div>;
  }
  //#endregion useAutoResize_manualApp
}
