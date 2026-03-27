import type { ContentBlock } from "@modelcontextprotocol/sdk/types.js";
import type { McpUiSupportedContentBlockModalities } from "./types";

/**
 * Maps a ContentBlock `type` to its corresponding modality key
 * in {@link McpUiSupportedContentBlockModalities}.
 */
const CONTENT_TYPE_TO_MODALITY: Record<
  string,
  keyof McpUiSupportedContentBlockModalities | undefined
> = {
  text: "text",
  image: "image",
  audio: "audio",
  resource: "resource",
  resource_link: "resourceLink",
};

/**
 * Result of validating content blocks against supported modalities.
 */
interface ContentValidationResult {
  /** Whether all content blocks (and structuredContent if provided) are supported. */
  valid: boolean;
  /** Deduplicated list of unsupported content block type names. */
  unsupportedTypes: string[];
  /** Whether structuredContent was provided but not supported. */
  structuredContentUnsupported: boolean;
}

/**
 * Validate content blocks and optional structuredContent against declared modalities.
 *
 * Returns `{ valid: true }` if `modalities` is `undefined` (backwards compatibility:
 * host did not declare the capability, so all types are allowed).
 *
 * @param content - Array of content blocks to validate (may be undefined/empty)
 * @param modalities - Supported modalities declared by the host, or undefined to skip validation
 * @param hasStructuredContent - Whether structuredContent is present in the request
 * @returns Validation result with details about unsupported types
 */
export function validateContentModalities(
  content: ContentBlock[] | undefined,
  modalities: McpUiSupportedContentBlockModalities | undefined,
  hasStructuredContent: boolean = false,
): ContentValidationResult {
  // Backwards compatibility: if modalities is undefined, skip validation entirely
  if (modalities === undefined) {
    return {
      valid: true,
      unsupportedTypes: [],
      structuredContentUnsupported: false,
    };
  }

  const unsupportedTypes = new Set<string>();
  let structuredContentUnsupported = false;

  // Check each content block
  if (content) {
    for (const block of content) {
      const modalityKey =
        CONTENT_TYPE_TO_MODALITY[(block as { type: string }).type];
      if (modalityKey === undefined || !(modalityKey in modalities)) {
        unsupportedTypes.add((block as { type: string }).type);
      }
    }
  }

  // Check structuredContent
  if (hasStructuredContent && !("structuredContent" in modalities)) {
    structuredContentUnsupported = true;
  }

  const valid = unsupportedTypes.size === 0 && !structuredContentUnsupported;
  return {
    valid,
    unsupportedTypes: [...unsupportedTypes],
    structuredContentUnsupported,
  };
}

/**
 * Build a human-readable error message from a failed validation result.
 *
 * @param result - The validation result (must have `valid: false`)
 * @param method - The protocol method name for context in the error message
 * @returns Error message string
 */
export function buildValidationErrorMessage(
  result: ContentValidationResult,
  method: string,
): string {
  const parts: string[] = [];
  if (result.unsupportedTypes.length > 0) {
    parts.push(
      `unsupported content type(s): ${result.unsupportedTypes.join(", ")}`,
    );
  }
  if (result.structuredContentUnsupported) {
    parts.push("structuredContent is not supported");
  }
  return `${method}: ${parts.join("; ")}`;
}
