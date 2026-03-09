/**
 * TypeDoc plugin that fixes mermaid diagram rendering issues.
 *
 * 1. Decodes HTML entities in mermaid code blocks before the mermaid plugin
 *    processes them. The @boneskull/typedoc-plugin-mermaid converts &lt; to #lt;
 *    and &gt; to #gt;, but those aren't valid mermaid entities.
 *
 * 2. Removes dark-theme mermaid divs to fix duplicate marker IDs. The mermaid
 *    plugin creates both dark and light variants with identical marker IDs
 *    (e.g., `#arrowhead`), causing the browser to resolve references to the
 *    wrong SVG. By keeping only light-theme divs, we avoid duplicate IDs.
 *    CSS filters handle dark mode styling.
 */

import { Renderer } from "typedoc";

/**
 * Decode HTML entities back to raw characters.
 * @param {string} html - HTML-encoded string
 * @returns {string} Decoded string
 */
function decodeHtmlEntities(html) {
  return html
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&"); // Must be last
}

/**
 * CSS to invert mermaid diagrams in dark mode.
 * Since we only render light-theme diagrams, we use CSS filters for dark mode.
 */
const darkModeStyles = `
<style>
:root[data-theme="dark"] .mermaid-block .mermaid svg {
  filter: invert(1) hue-rotate(180deg);
}
</style>
`;

/**
 * TypeDoc plugin entry point.
 * @param {import('typedoc').Application} app
 */
export function load(app) {
  // Use high priority (200) to run before the mermaid plugin (default is 0)
  app.renderer.on(
    Renderer.EVENT_END_PAGE,
    (page) => {
      if (!page.contents) return;

      // Find mermaid code blocks and decode HTML entities
      page.contents = page.contents.replace(
        /<code class="mermaid">([\s\S]*?)<\/code>/g,
        (match, code) => {
          const decoded = decodeHtmlEntities(code);
          return `<code class="mermaid">${decoded}</code>`;
        },
      );
    },
    200,
  );

  // Use low priority (-100) to run after the mermaid plugin injects its content
  app.renderer.on(
    Renderer.EVENT_END_PAGE,
    (page) => {
      if (!page.contents) return;
      if (!page.contents.includes('class="mermaid-block"')) return;

      // Remove dark-theme mermaid divs to avoid duplicate marker IDs
      page.contents = page.contents.replace(
        /<div class="mermaid dark">[\s\S]*?<\/div>/g,
        "",
      );

      // Also remove the CSS that hides light-theme divs by default
      // The mermaid plugin adds visibility:hidden until JS sets display:block
      // Since we only have light divs now, make them visible immediately
      page.contents = page.contents.replace(
        /<div class="mermaid light">/g,
        '<div class="mermaid" style="display: block">',
      );

      // Add dark mode CSS filter before </head>
      const headEndIndex = page.contents.indexOf("</head>");
      if (headEndIndex !== -1) {
        page.contents =
          page.contents.slice(0, headEndIndex) +
          darkModeStyles +
          page.contents.slice(headEndIndex);
      }
    },
    -100,
  );
}
