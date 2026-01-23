import { useEffect, RefObject } from "react";
import { App } from "../app";

/**
 * React hook that automatically reports UI size changes to the host.
 *
 * Uses `ResizeObserver` to watch `document.body` and `document.documentElement` for
 * size changes and sends `ui/notifications/size-changed` notifications.
 *
 * The hook automatically cleans up the `ResizeObserver` when the component unmounts.
 *
 * **Note**: This hook is rarely needed since the {@link useApp `useApp`} hook automatically enables
 * auto-resize by default. This hook is provided for advanced cases where you
 * create the {@link App `App`} manually with `autoResize: false` and want to add auto-resize
 * behavior later.
 *
 * @param app - The connected {@link App `App`} instance, or null during initialization
 * @param elementRef - Currently unused. The hook always observes `document.body`
 *   and `document.documentElement` regardless of this value. Passing a ref will
 *   cause unnecessary effect re-runs; omit this parameter.
 *
 * @example Manual App creation with custom auto-resize control
 * ```tsx source="./useAutoResize.examples.tsx#useAutoResize_manualApp"
 * function MyComponent() {
 *   // For custom App options, create App manually instead of using useApp
 *   const [app, setApp] = useState<App | null>(null);
 *   const [error, setError] = useState<Error | null>(null);
 *
 *   useEffect(() => {
 *     const myApp = new App(
 *       { name: "MyApp", version: "1.0.0" },
 *       {}, // capabilities
 *       { autoResize: false }, // Disable default auto-resize
 *     );
 *
 *     const transport = new PostMessageTransport(window.parent, window.parent);
 *     myApp
 *       .connect(transport)
 *       .then(() => setApp(myApp))
 *       .catch((err) => setError(err));
 *   }, []);
 *
 *   // Add manual auto-resize control
 *   useAutoResize(app);
 *
 *   if (error) return <div>Connection failed: {error.message}</div>;
 *   return <div>My content</div>;
 * }
 * ```
 *
 * @see {@link App.setupSizeChangedNotifications `App.setupSizeChangedNotifications`} for the underlying implementation
 * @see {@link useApp `useApp`} which enables auto-resize by default
 * @see {@link App `App`} constructor for configuring `autoResize` option
 */
export function useAutoResize(
  app: App | null,
  elementRef?: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!app) {
      return;
    }

    return app.setupSizeChangedNotifications();
  }, [app, elementRef]);
}
