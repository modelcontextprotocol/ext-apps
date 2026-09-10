import type { McpUiResourceCsp } from "@modelcontextprotocol/ext-apps";

// Validate CSP domain entries to prevent injection attacks.
// Rejects entries containing characters that could:
// - `;` or newlines: break out to new CSP directive
// - quotes: inject CSP keywords like 'unsafe-eval'
// - space: inject multiple sources in one entry
function sanitizeCspDomains(domains?: string[]): string[] {
  if (!domains) return [];
  return domains.filter((d) => typeof d === "string" && !/[;\r\n'" ]/.test(d));
}

export function buildCspHeader(csp?: McpUiResourceCsp): string {
  const resourceDomains = sanitizeCspDomains(csp?.resourceDomains).join(" ");
  const connectDomains = sanitizeCspDomains(csp?.connectDomains).join(" ");
  const frameDomains = sanitizeCspDomains(csp?.frameDomains).join(" ") || null;
  const baseUriDomains =
    sanitizeCspDomains(csp?.baseUriDomains).join(" ") || null;

  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    ...(csp?.wasmUnsafeEval === true ? ["'wasm-unsafe-eval'"] : []),
    "blob:",
    "data:",
  ].join(" ");

  const directives = [
    // Default: allow same-origin + inline styles/scripts (needed for bundled apps)
    "default-src 'self' 'unsafe-inline'",
    // Scripts: same-origin + inline + eval (some libs need eval) + blob (workers) + specified domains
    `script-src ${scriptSources} ${resourceDomains}`.trim(),
    // Styles: same-origin + inline + specified domains
    `style-src 'self' 'unsafe-inline' blob: data: ${resourceDomains}`.trim(),
    // Images: same-origin + data/blob URIs + specified domains
    `img-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Fonts: same-origin + data/blob URIs + specified domains
    `font-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Media (audio/video): same-origin + data/blob URIs + specified domains
    `media-src 'self' data: blob: ${resourceDomains}`.trim(),
    // Network requests: same-origin + specified API/tile domains
    `connect-src 'self' ${connectDomains}`.trim(),
    // Workers: same-origin + blob (dynamic workers) + specified domains
    // This is critical for WebGL apps (CesiumJS, Three.js) that use workers for:
    // - Tile decoding and terrain processing
    // - Image processing and texture loading
    // - Physics and geometry calculations
    `worker-src 'self' blob: ${resourceDomains}`.trim(),
    // Nested iframes: use frameDomains if provided, otherwise block all
    frameDomains ? `frame-src ${frameDomains}` : "frame-src 'none'",
    // Plugins: always blocked (defense in depth)
    "object-src 'none'",
    // Base URI: use baseUriDomains if provided, otherwise block all
    baseUriDomains ? `base-uri ${baseUriDomains}` : "base-uri 'none'",
  ];

  return directives.join("; ");
}
