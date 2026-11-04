/**
 * How this host shows `resource` and `resource_link` blocks that a View sends
 * in `ui/message` and `ui/update-model-context`.
 *
 * The View chose every `uri` here, so the host never retrieves one by itself:
 * no fetch, no preview, no icon, and no `<a href>` that a click would navigate
 * to. A link is read only when the user presses its button, and only with
 * `resources/read` on the MCP server that provided the View.
 */
import type { ContentBlock, ReadResourceResult, ResourceLink } from "@modelcontextprotocol/client";
import { useState } from "react";
import type { ServerInfo } from "./implementation";
import styles from "./resource-blocks.module.css";

/** Text shown for a content block in the Messages and Model Context panels. */
export function formatContentBlock(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "image":
    case "audio":
      return `<${block.type}: ${block.mimeType ?? "unknown"}>`;
    case "resource": {
      // The content came with the block. Its `uri` is the View's label for
      // it, not a place this host read it from.
      const { uri, mimeType } = block.resource;
      const type = mimeType ? `, ${mimeType}` : "";
      return "text" in block.resource
        ? `<embedded resource labelled ${uri}${type}>\n${block.resource.text}`
        : `<embedded resource labelled ${uri}${type}, ${block.resource.blob.length} base64 chars>`;
    }
    case "resource_link":
      return `<resource link: ${block.name} → ${block.uri}${block.mimeType ? `, ${block.mimeType}` : ""}, not fetched>`;
    default:
      return `<${(block as { type: string }).type}>`;
  }
}

/** Short description of what `resources/read` returned, for display. */
function summarize(result: ReadResourceResult): string {
  return result.contents
    .map((c) =>
      "text" in c
        ? `${c.mimeType ?? "text"}, ${c.text.length} chars:\n${c.text.slice(0, 500)}${c.text.length > 500 ? "…" : ""}`
        : `${c.mimeType ?? "binary"}, ${c.blob.length} base64 chars`,
    )
    .join("\n\n") || "(no contents)";
}

interface ResourceLinkRowProps {
  link: ResourceLink;
  serverInfo: ServerInfo;
}
function ResourceLinkRow({ link, serverInfo }: ResourceLinkRowProps) {
  const [outcome, setOutcome] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const read = async () => {
    setReading(true);
    try {
      // Always the View's own server: the URI means nothing to any other
      // server, and this host must not resolve it itself.
      setOutcome(summarize(await serverInfo.client.readResource({ uri: link.uri })));
    } catch (error) {
      // No fallback to another way of fetching the URI.
      setOutcome(`resources/read failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReading(false);
    }
  };

  return (
    <div className={styles.resourceLink}>
      <div className={styles.resourceLinkHeader}>
        <span className={styles.resourceLinkName}>🔗 {link.name}</span>
        <code className={styles.resourceLinkUri}>{link.uri}</code>
        <button onClick={read} disabled={reading}>
          {reading ? "Reading…" : `Read from ${serverInfo.name}`}
        </button>
      </div>
      {outcome !== null && <pre className={styles.resourceLinkOutcome}>{outcome}</pre>}
    </div>
  );
}

interface ResourceLinksProps {
  /** Content blocks of the messages or of the model context that a View sent. */
  content: ContentBlock[];
  /** The server that provided the View: the only place a link is read from. */
  serverInfo: ServerInfo;
}
/** One row per resource link in `content`, each with a button that reads it on demand. */
export function ResourceLinks({ content, serverInfo }: ResourceLinksProps) {
  const links = content.filter((block) => block.type === "resource_link");
  return links.map((link, i) => (
    <ResourceLinkRow key={`${i}:${link.uri}`} link={link} serverInfo={serverInfo} />
  ));
}
