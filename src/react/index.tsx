/**
 * React utilities for building MCP Apps.
 *
 * This module provides React hooks and utilities for easily building
 * interactive MCP Apps using React. This is optional - the core SDK
 * ({@link App `App`}, {@link PostMessageTransport `PostMessageTransport`}) is framework-agnostic and can be
 * used with any UI framework or vanilla JavaScript.
 *
 * ## Main Exports
 *
 * - {@link useApp `useApp`} - React hook to create and connect an MCP App
 * - {@link useHostStyleVariables `useHostStyleVariables`} - React hook to apply host style variables and theme
 * - {@link useHostFonts `useHostFonts`} - React hook to apply host fonts
 * - {@link useDocumentTheme `useDocumentTheme`} - React hook for reactive document theme
 * - {@link useAutoResize `useAutoResize`} - React hook for manual auto-resize control (rarely needed)
 *
 * @module @modelcontextprotocol/ext-apps/react
 *
 * @example Basic React App
 * {@includeCode ./index.examples.tsx#index_basicReactApp}
 */
export * from "./useApp";
export * from "./useAutoResize";
export * from "./useDocumentTheme";
export * from "./useHostStyles";
