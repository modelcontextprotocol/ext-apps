/**
 * React utilities for building MCP Apps.
 *
 * This module provides React hooks and utilities for easily building
 * interactive MCP Apps using React. This is optional - the core SDK
 * ({@link App}, {@link PostMessageTransport}) is framework-agnostic and can be
 * used with any UI framework or vanilla JavaScript.
 *
 * ## Main Exports
 *
 * - {@link useApp} - React hook to create and connect an MCP App
 * - {@link useAutoResize} - React hook for manual auto-resize control (rarely needed)
 *
 * @module @modelcontextprotocol/ext-apps/react
 *
 * @example Basic React App
 * ```tsx
 * import { useApp } from '@modelcontextprotocol/ext-apps/react';
 *
 * function MyApp() {
 *   const { app, isConnected, error } = useApp({
 *     appInfo: { name: "MyApp", version: "1.0.0" },
 *     capabilities: {}
 *   });
 *
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!isConnected) return <div>Connecting...</div>;
 *
 *   return <div>Connected!</div>;
 * }
 * ```
 */
export * from "./useApp";
export * from "./useAutoResize";
