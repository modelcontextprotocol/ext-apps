/**
 * Type-checked examples for the React module overview.
 *
 * @module
 */

import { useApp } from "./index.js";

/**
 * Example: Basic React App from module overview.
 */
function index_basicReactApp() {
  //#region index_basicReactApp
  function MyApp() {
    const { app, isConnected, error } = useApp({
      appInfo: { name: "MyApp", version: "1.0.0" },
      capabilities: {},
    });

    if (error) return <div>Error: {error.message}</div>;
    if (!isConnected) return <div>Connecting...</div>;

    return <div>Connected!</div>;
  }
  //#endregion index_basicReactApp
}
