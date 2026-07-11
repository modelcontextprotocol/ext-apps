/**
 * TypeDoc plugin that adds SEO metadata to generated pages.
 *
 * - Normalizes document page filenames to lowercase-hyphenated slugs
 * - Injects JSON-LD (TechArticle / WebPage) structured data for search crawlers
 * - Adds per-page meta description tags extracted from page content
 * - Copies favicons to the output directory
 */

import { Renderer } from "typedoc";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import * as htmlparser2 from "htmlparser2";

const SITE_NAME = "MCP Apps";

/**
 * Convert a TypeDoc-generated document filename to a lowercase hyphenated slug.
 * e.g. "CSP_and_CORS.html" → "csp-and-cors.html"
 *      "Testing_MCP_Apps.html" → "testing-mcp-apps.html"
 * @param {string} filename
 * @returns {string}
 */
function toSlug(filename) {
  return filename
    .replace(/\.html$/, "")
    .replace(/_/g, "-")
    .toLowerCase()
    .concat(".html");
}

/**
 * Extract a plain-text description from the rendered HTML body.
 * Parses the first content paragraph using htmlparser2 and truncates.
 * @param {string} html
 * @returns {string}
 */
function extractDescription(html) {
  // Find the main content area
  const contentMatch = html.match(
    /<div class="tsd-panel tsd-typography">([\s\S]*?)<\/div>\s*<\/div>/,
  );
  if (!contentMatch) return "";

  const content = contentMatch[1];

  // Find first <p> that has real content (skip headings, code blocks, lists)
  const paragraphs = content.match(/<p>([^<][\s\S]*?)<\/p>/g);
  if (!paragraphs) return "";

  for (const p of paragraphs) {
    const text = htmlparser2
      .parseDocument(p)
      .children.map((node) => htmlparser2.DomUtils.textContent(node))
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    // Skip very short or code-heavy paragraphs
    if (text.length > 40) {
      return text.length > 160 ? text.slice(0, 157) + "..." : text;
    }
  }

  return "";
}

/**
 * Extract the page title from the <title> tag.
 * @param {string} html
 * @returns {string}
 */
function extractTitle(html) {
  const match = html.match(/<title>([^<]+)<\/title>/);
  return match ? match[1] : SITE_NAME;
}

/**
 * Determine if a page is a document (guide) or API reference page.
 * @param {string} url
 * @returns {boolean}
 */
function isDocumentPage(url) {
  return url.includes("documents/");
}

/**
 * Build a JSON-LD structured data object for the page.
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.description
 * @param {string} options.url
 * @param {boolean} options.isDocument
 * @returns {object}
 */
function buildJsonLd({ title, description, url, isDocument }) {
  return {
    "@context": "https://schema.org",
    "@type": isDocument ? "TechArticle" : "WebPage",
    name: title,
    headline: title,
    ...(description && { description }),
    ...(url && { url }),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: "https://apps.extensions.modelcontextprotocol.io/",
    },
  };
}

/**
 * TypeDoc plugin entry point.
 * @param {import('typedoc').Application} app
 */
export function load(app) {
  const hostedBaseUrl = app.options.getValue("hostedBaseUrl") || "";

  // --- Per-page: inject JSON-LD, meta descriptions, and favicons ---
  app.renderer.on(Renderer.EVENT_END_PAGE, (page) => {
    if (!page.contents) return;

    const title = extractTitle(page.contents);

    // Prefer frontmatter description, fall back to auto-extraction
    const frontmatterDesc =
      page.model?.isDocument?.() && page.model.frontmatter?.description
        ? String(page.model.frontmatter.description)
        : "";
    const description = frontmatterDesc || extractDescription(page.contents);
    const fullUrl = hostedBaseUrl
      ? `${hostedBaseUrl.replace(/\/$/, "")}/${page.url}`
      : "";

    // Build JSON-LD
    const jsonLd = buildJsonLd({
      title,
      description,
      url: fullUrl,
      isDocument: isDocumentPage(page.url),
    });

    const jsonLdScript = `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

    // Build meta description tag (replace the generic one if present)
    const metaDescription = description
      ? `<meta name="description" content="${description.replace(/"/g, "&quot;")}"/>`
      : "";

    // Replace existing generic meta description
    if (metaDescription) {
      page.contents = page.contents.replace(
        /<meta name="description" content="Documentation for [^"]*"\/>/,
        metaDescription,
      );
    }

    // Build favicon tags with correct relative path
    const depth = page.url.split("/").length - 1;
    const base = depth > 0 ? "../".repeat(depth) : "./";
    const faviconTags = [
      `<link rel="icon" href="${base}favicons/favicon-32x32.png" type="image/png" sizes="32x32" media="(prefers-color-scheme: light)"/>`,
      `<link rel="icon" href="${base}favicons/favicon-16x16.png" type="image/png" sizes="16x16" media="(prefers-color-scheme: light)"/>`,
      `<link rel="shortcut icon" href="${base}favicons/favicon.ico" type="image/x-icon" media="(prefers-color-scheme: light)"/>`,
      `<link rel="icon" href="${base}favicons/favicon-dark-32x32.png" type="image/png" sizes="32x32" media="(prefers-color-scheme: dark)"/>`,
      `<link rel="icon" href="${base}favicons/favicon-dark-16x16.png" type="image/png" sizes="16x16" media="(prefers-color-scheme: dark)"/>`,
      `<link rel="shortcut icon" href="${base}favicons/favicon-dark.ico" type="image/x-icon" media="(prefers-color-scheme: dark)"/>`,
      `<link rel="apple-touch-icon" href="${base}favicons/apple-touch-icon.png" type="image/png" sizes="180x180"/>`,
    ].join("\n");

    // Inject favicons and JSON-LD before </head>
    const headInjections = [faviconTags, jsonLdScript]
      .filter(Boolean)
      .join("\n");

    page.contents = page.contents.replace(
      "</head>",
      headInjections + "\n</head>",
    );
  });

  // --- Post-render: copy favicons + rename document slugs ---
  app.renderer.on(Renderer.EVENT_END, (event) => {
    const outDir = event.outputDirectory;

    // Copy favicons to output directory
    const srcFavicons = path.join(path.dirname(outDir), "favicons");
    const destFavicons = path.join(outDir, "favicons");
    if (fs.existsSync(srcFavicons)) {
      if (!fs.existsSync(destFavicons)) fs.mkdirSync(destFavicons);
      for (const file of fs.readdirSync(srcFavicons)) {
        fs.copyFileSync(
          path.join(srcFavicons, file),
          path.join(destFavicons, file),
        );
      }
    }

    const docsDir = path.join(outDir, "documents");

    if (!fs.existsSync(docsDir)) return;

    // Build rename map: old filename → new slug
    const renameMap = new Map();
    for (const file of fs.readdirSync(docsDir)) {
      if (!file.endsWith(".html")) continue;
      const slug = toSlug(file);
      if (slug !== file) {
        renameMap.set(file, slug);
      }
    }

    if (renameMap.size === 0) return;

    // Rename the files
    for (const [oldName, newName] of renameMap) {
      fs.renameSync(path.join(docsDir, oldName), path.join(docsDir, newName));
    }

    // Build link replacement patterns (documents/OldName.html → documents/new-name.html)
    const replacements = [...renameMap.entries()].map(([oldName, newName]) => ({
      old: `documents/${oldName}`,
      new: `documents/${newName}`,
    }));

    // Update all HTML files in the output directory
    updateLinksRecursive(outDir, replacements);

    // Update compressed JS data files (navigation + search index)
    updateCompressedJsData(
      path.join(outDir, "assets", "navigation.js"),
      "navigationData",
      replacements,
    );
    updateCompressedJsData(
      path.join(outDir, "assets", "search.js"),
      "searchData",
      replacements,
    );

    // Update sitemap.xml
    const sitemapPath = path.join(outDir, "sitemap.xml");
    if (fs.existsSync(sitemapPath)) {
      let sitemap = fs.readFileSync(sitemapPath, "utf8");
      for (const r of replacements) {
        sitemap = sitemap.replaceAll(r.old, r.new);
      }
      fs.writeFileSync(sitemapPath, sitemap);
    }
  });
}

/**
 * Decompress a TypeDoc JS data file, replace document slugs, and recompress.
 * TypeDoc stores navigation and search data as deflate-compressed base64.
 * @param {string} filePath
 * @param {string} varName - JS variable name (e.g. "navigationData", "searchData")
 * @param {Array<{old: string, new: string}>} replacements
 */
function updateCompressedJsData(filePath, varName, replacements) {
  if (!fs.existsSync(filePath)) return;

  let content = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(`window\\.${varName} = "(.+)"`);
  const match = content.match(pattern);
  if (!match) return;

  // Decompress
  const buf = Buffer.from(match[1], "base64");
  let json = zlib.inflateSync(buf).toString();

  // Replace slugs
  let changed = false;
  for (const r of replacements) {
    if (json.includes(r.old)) {
      json = json.replaceAll(r.old, r.new);
      changed = true;
    }
  }

  if (!changed) return;

  // Recompress and write
  const compressed = zlib.deflateSync(json);
  const encoded = compressed.toString("base64");
  content = content.replace(pattern, `window.${varName} = "${encoded}"`);
  fs.writeFileSync(filePath, content);
}

/**
 * Recursively update links in all HTML files under a directory.
 * @param {string} dir
 * @param {Array<{old: string, new: string}>} replacements
 */
function updateLinksRecursive(dir, replacements) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      updateLinksRecursive(fullPath, replacements);
    } else if (entry.name.endsWith(".html") || entry.name.endsWith(".js")) {
      let content = fs.readFileSync(fullPath, "utf8");
      let changed = false;
      for (const r of replacements) {
        if (content.includes(r.old)) {
          content = content.replaceAll(r.old, r.new);
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}
