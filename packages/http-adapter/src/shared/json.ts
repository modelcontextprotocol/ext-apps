/**
 * JSON helpers shared across HTTP adapters.
 */

/**
 * Options for safe JSON parsing.
 */
export interface JsonParseOptions {
  context?: string;
  debug?: boolean;
}

/**
 * Safely parses JSON, returning undefined on failure.
 *
 * **Side effect:** Always logs a warning on parse failure (or debug-level log
 * when `options.debug` is true). Check the console if you suspect JSON parsing issues.
 *
 * @param value - The string to parse as JSON
 * @param options - Optional configuration for error context and debug logging
 * @returns The parsed JSON value, or `undefined` if parsing fails
 */
export function safeJsonParse(
  value: string,
  options: JsonParseOptions = {},
): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch (error) {
    const context = options.context ?? "JSON value";
    const detail = error instanceof Error ? error.message : String(error);
    const preview = value.length > 100 ? `${value.slice(0, 100)}...` : value;
    if (options.debug) {
      console.debug(`[MCP HTTP] JSON parse failed for ${context}:`, detail);
    } else {
      console.warn(
        `[MCP HTTP] JSON parse failed for ${context}: ${detail}. Value preview: ${preview}`,
      );
    }
    return undefined;
  }
}
