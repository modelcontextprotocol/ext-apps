/**
 * Lazy Auth demo MCP server.
 *
 * Demonstrates "lazy" (on-demand) OAuth for MCP servers and Apps:
 *
 *  - The server connects without authentication: `initialize`, `tools/list`,
 *    and public tool calls all succeed with no Bearer token.
 *  - Protected tools (`get_secret`, `revoke_auth_token`) return 401 with a
 *    `WWW-Authenticate` header pointing at protected-resource metadata, so the
 *    host only runs the OAuth flow when a protected tool is actually called.
 *  - The `show_auth_button` MCP App is public; clicking its button calls the
 *    protected `get_secret` tool via `callServerTool`. The host sees the 401,
 *    runs OAuth, retries, and the result renders inline.
 *
 * The embedded OAuth authorization server is intentionally minimal and
 * stateless (HS256 JWTs, auth codes encoded as short-lived JWTs) so the demo
 * can run anywhere with a single env var. It is NOT a production AS.
 */
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { UrlElicitationRequiredError } from "@modelcontextprotocol/sdk/types.js";
import type {
  CallToolResult,
  ReadResourceResult,
} from "@modelcontextprotocol/sdk/types.js";
import cors from "cors";
import express, { type Express, type Request, type Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Works both from source (server.ts) and compiled (dist/server.js). Derived
// from import.meta.url rather than import.meta.filename/dirname, which are
// undefined in some module-VM contexts (e.g. importing this package from
// jest).
const SERVER_FILE = fileURLToPath(import.meta.url);
const DIST_DIR = SERVER_FILE.endsWith(".ts")
  ? path.join(path.dirname(SERVER_FILE), "dist")
  : path.dirname(SERVER_FILE);

// ─── Config ──────────────────────────────────────────────────────────────────

export const PORT = parseInt(process.env.PORT ?? "3097", 10);
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ??
    "dev-insecure-secret-do-not-use-in-production-" + "x".repeat(20),
);
const PROTECTED_TOOLS = new Set(["get_secret", "revoke_auth_token"]);
// Token lifetimes. Defaults are deliberately short so the host's refresh flow
// (30s–5min after auth) and full re-auth (>5min) are easy to observe in a demo.
// Slow or automated clients can request longer-lived tokens per connection by
// connecting to a TTL-scoped endpoint path (/ttl/<seconds>/mcp) — see
// ttlFromResource() and the README.
const ACCESS_TOKEN_TTL_SECONDS = parseInt(
  process.env.ACCESS_TOKEN_TTL_SECONDS ?? "30",
  10,
);
const REFRESH_TOKEN_TTL_SECONDS = parseInt(
  process.env.REFRESH_TOKEN_TTL_SECONDS ?? "300",
  10,
);
// Cap on per-connection `?token_ttl_s=` requests.
const MAX_TOKEN_TTL_SECONDS = 86400;
// When true: root well-known PRM returns *stub* metadata WITHOUT authorization_servers,
// and root well-known AS is 404. Hosts probing well-known on connect see "resource has
// PRM but no auth configured" → connect without OAuth. Real PRM (with authorization_servers)
// is only at /auth/prm, reachable via WWW-Authenticate on 401. Default false = standard.
const REACTIVE_AUTH_ONLY = process.env.REACTIVE_AUTH_ONLY === "1";

/** Hostname is localhost / a loopback address (URL-style, so IPv6 keeps its brackets). */
function isLoopbackHostname(hostname: string): boolean {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) ||
    hostname.endsWith(".localhost")
  );
}

/**
 * Resolve the public base URL for this deployment.
 *
 * Precedence: the PUBLIC_URL env var, then the request's Host header (loopback
 * hosts only), then http://localhost:PORT. Host / X-Forwarded-* headers naming
 * non-loopback hosts are deliberately NOT trusted — a client could spoof them
 * to make OAuth metadata and callback URLs point at a host it controls.
 * Non-localhost deployments (e.g. behind a public tunnel) must set PUBLIC_URL
 * explicitly.
 */
function resolvePublicUrl(req?: Request): URL {
  // Mount path when this app is mounted inside another Express app
  // (e.g. app.use("/lazy-auth", createApp())). Empty when standalone.
  // PUBLIC_URL, when set, must already include any mount path.
  const basePath = req?.baseUrl ?? "";
  const envUrl = process.env.PUBLIC_URL;
  if (envUrl) return new URL(envUrl.endsWith("/") ? envUrl : envUrl + "/");
  const host = req?.headers.host;
  if (host) {
    try {
      const url = new URL(`http://${host}${basePath}/`);
      if (isLoopbackHostname(url.hostname)) return url;
    } catch {
      // Malformed Host header → fall through to the localhost default.
    }
  }
  return new URL(`http://localhost:${PORT}${basePath}/`);
}

/** Public base URL as a string with no trailing slash (may include a base path). */
function publicBaseHref(req?: Request): string {
  const href = resolvePublicUrl(req).href;
  return href.endsWith("/") ? href.slice(0, -1) : href;
}

/** OAuth issuer. In REACTIVE_AUTH_ONLY mode, uses a /auth subpath so root well-known 404s.
 *  Otherwise uses the public base URL (origin + any mount path). */
const ISSUER_SUFFIX = REACTIVE_AUTH_ONLY ? "/auth" : "";
function resolveIssuer(req?: Request): string {
  return publicBaseHref(req) + ISSUER_SUFFIX;
}

// ─── Mock OAuth (HS256, stateless codes) ─────────────────────────────────────

interface CodePayload {
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  /** Requested access-token TTL, from `?token_ttl_s=` on the resource indicator. */
  token_ttl_s?: number;
}

/** Validate + cap a raw TTL value (from a path segment or query param). */
function parseTtlSeconds(raw: string | undefined): number | undefined {
  const ttl = parseInt(raw ?? "", 10);
  return Number.isFinite(ttl) && ttl > 0
    ? Math.min(ttl, MAX_TOKEN_TTL_SECONDS)
    : undefined;
}

/**
 * Extract the requested access-token TTL from a resource indicator (RFC 8707).
 *
 * MCP hosts send `resource=<MCP server URL>` — the URL the client connected
 * to — in authorization and token requests. Clients opt into a non-default
 * token lifetime by connecting to a TTL-scoped MCP endpoint path:
 *
 *     /ttl/<seconds>/mcp     (e.g. /ttl/3600/mcp for 1-hour tokens)
 *
 * The TTL lives in the PATH because hosts canonicalize resource indicators and
 * strip query strings (verified against real hosts), so `?token_ttl_s=` query
 * params would never reach this server's OAuth endpoints. The query param is
 * still honored as a fallback for clients that preserve it.
 */
function ttlFromResource(resource: string | undefined): number | undefined {
  if (!resource) return undefined;
  try {
    const url = new URL(resource);
    const pathMatch = url.pathname.match(/\/ttl\/(\d+)\/mcp$/);
    return (
      parseTtlSeconds(pathMatch?.[1]) ??
      parseTtlSeconds(url.searchParams.get("token_ttl_s") ?? undefined)
    );
  } catch {
    return undefined;
  }
}

interface AuthInfo {
  token: string;
  sub: string;
  sid: string;
}

// ─── Session revocation ───────────────────────────────────────────────────────
//
// Each OAuth session (authorize → code → tokens) gets a single `sid`; all access &
// refresh tokens in that session carry it. Revoking the sid invalidates both → host
// must do a full re-OAuth (refresh grant also fails).
//
// Storage is an in-memory Map, which is fine for a single-process demo server. If
// you deploy this to a multi-instance/serverless environment, back it with a
// shared store instead.

const revokedSids = new Map<string, number>(); // sid → unix GC time
// Revoked-sid entries need only outlive the longest token TTL; add small clock-skew grace.
const REVOCATION_GC_TTL_SECONDS =
  Math.max(
    ACCESS_TOKEN_TTL_SECONDS,
    REFRESH_TOKEN_TTL_SECONDS,
    MAX_TOKEN_TTL_SECONDS,
  ) + 10;

function revokeSession(sid: string): void {
  revokedSids.set(
    sid,
    Math.floor(Date.now() / 1000) + REVOCATION_GC_TTL_SECONDS,
  );
  const now = Math.floor(Date.now() / 1000);
  for (const [k, gc] of revokedSids) if (gc < now) revokedSids.delete(k);
}

function isSessionRevoked(sid: string | undefined): boolean {
  if (!sid) return false;
  return revokedSids.has(sid);
}

async function signAccessToken(
  sub: string,
  scope: string,
  sid: string,
  issuer: string,
  audience: string,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ sub, scope, sid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(JWT_SECRET);
}

async function signRefreshToken(
  sub: string,
  scope: string,
  sid: string,
  issuer: string,
  ttlSeconds: number = REFRESH_TOKEN_TTL_SECONDS,
  accessTtlSeconds?: number,
): Promise<string> {
  // access_ttl_s carries the grant's requested access-token TTL forward so
  // refreshed access tokens keep the same lifetime as the original.
  return new SignJWT({
    sub,
    scope,
    sid,
    typ: "refresh",
    ...(accessTtlSeconds !== undefined
      ? { access_ttl_s: accessTtlSeconds }
      : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(issuer)
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(JWT_SECRET);
}

async function verifyRefreshToken(
  token: string,
  issuer: string,
): Promise<
  | { sub: string; scope: string; sid: string; accessTtlSeconds?: number }
  | undefined
> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { issuer });
    if (payload.typ !== "refresh") return undefined;
    const sid = payload.sid as string | undefined;
    if (isSessionRevoked(sid)) return undefined; // session revoked → refresh fails
    return {
      sub: payload.sub ?? "",
      scope: (payload.scope as string) ?? "",
      sid: sid ?? "",
      accessTtlSeconds:
        typeof payload.access_ttl_s === "number"
          ? payload.access_ttl_s
          : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Encode grant details inside the code itself (5min expiry) — no server storage. */
async function signAuthCode(
  payload: CodePayload,
  issuer: string,
): Promise<string> {
  return new SignJWT({ ...payload, typ: "code" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setIssuer(issuer)
    .setExpirationTime("5m")
    .sign(JWT_SECRET);
}

// Authorization codes are single-use (RFC 6749 §4.1.2): remember redeemed code
// IDs until the code's own 5-minute expiry makes replay impossible anyway.
const redeemedCodeJtis = new Map<string, number>(); // jti → unix GC time

async function verifyAuthCode(
  code: string,
  issuer: string,
): Promise<CodePayload | undefined> {
  try {
    const { payload } = await jwtVerify(code, JWT_SECRET, { issuer });
    if (payload.typ !== "code" || !payload.jti) return undefined;
    const now = Math.floor(Date.now() / 1000);
    for (const [k, gc] of redeemedCodeJtis)
      if (gc < now) redeemedCodeJtis.delete(k);
    if (redeemedCodeJtis.has(payload.jti)) return undefined; // already redeemed
    redeemedCodeJtis.set(payload.jti, now + 5 * 60 + 10);
    return payload as unknown as CodePayload;
  } catch {
    return undefined;
  }
}

async function verifyAccessToken(
  token: string,
  issuer: string,
  maxAgeSeconds?: number,
): Promise<AuthInfo | undefined> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, { issuer });
    if (payload.typ === "code" || payload.typ === "refresh") return undefined; // only plain access tokens
    const sid = payload.sid as string | undefined;
    if (isSessionRevoked(sid)) return undefined; // session revoked
    // Per-connection TTL override (?token_ttl_s= on the MCP URL): treat tokens
    // older than maxAgeSeconds as expired even though their exp claim is still
    // in the future. Lets one deployment serve both long-TTL (default) and
    // short-TTL (refresh-flow testing) connections.
    if (maxAgeSeconds !== undefined && typeof payload.iat === "number") {
      const ageSeconds = Math.floor(Date.now() / 1000) - payload.iat;
      if (ageSeconds > maxAgeSeconds) return undefined;
    }
    return { token, sub: payload.sub ?? "", sid: sid ?? "" };
  } catch {
    return undefined;
  }
}

function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

/**
 * This demo AS has no client registry, so it can't check redirect URIs against
 * pre-registered values. At minimum, only allow https targets (or http on
 * loopback for local development hosts) so the consent page never links to,
 * or redirects the authorization code to, an unexpected scheme.
 */
function isAllowedRedirectUri(redirectUri: string): boolean {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

async function handleAuthorize(req: Request, res: Response) {
  const {
    client_id,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    scope,
    approved,
    resource,
  } = req.query as Record<string, string>;
  if (!redirect_uri) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Missing redirect_uri",
    });
    return;
  }
  if (!isAllowedRedirectUri(redirect_uri)) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri must use https (or http on localhost)",
    });
    return;
  }
  // PKCE is mandatory (the MCP auth spec requires it of clients, and this AS
  // only advertises S256). Rejecting up front keeps stolen-code attacks out of
  // the demo even though it has no real data to protect.
  if (!code_challenge || code_challenge_method !== "S256") {
    res.status(400).json({
      error: "invalid_request",
      error_description: "PKCE with S256 code_challenge is required",
    });
    return;
  }
  const issuer = resolveIssuer(req);

  if (approved !== "1") {
    // Show consent page. Keeps the OAuth popup visible so users can see the flow.
    const approveUrl = new URL(publicBaseHref(req) + "/authorize");
    for (const [k, v] of Object.entries(req.query))
      if (v) approveUrl.searchParams.set(k, String(v));
    approveUrl.searchParams.set("approved", "1");
    const denyUrl = new URL(redirect_uri);
    denyUrl.searchParams.set("error", "access_denied");
    if (state) denyUrl.searchParams.set("state", state);
    res.type("text/html").send(/*html*/ `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authorize</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px;color-scheme:light dark}
.box{border:1px solid #ccc;border-radius:8px;padding:20px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px;margin:16px 0}
dt{color:#888}dd{margin:0;word-break:break-all}
.actions{display:flex;flex-wrap:wrap;gap:12px;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.btn{box-sizing:border-box;flex:1;min-height:56px;min-width:56px;display:flex;align-items:center;justify-content:center;
padding:12px 20px;font-size:16px;font-weight:bold;border:none;border-radius:8px;cursor:pointer;
text-decoration:none;color:#fff;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
.btn:active{filter:brightness(0.8)}
.approve{background:#1a7a3e}.deny{background:#b91c1c}</style></head>
<body><div class="box">
<h2>🔑 Mock Authorization</h2>
<p>An application is requesting access:</p>
<dl><dt>Client</dt><dd>${escapeHtml(client_id ?? "(none)")}</dd>
<dt>Scope</dt><dd>${escapeHtml(scope ?? "(default)")}</dd>
<dt>Redirect</dt><dd>${escapeHtml(redirect_uri)}</dd></dl>
<div class="actions">
<a class="btn approve" role="button" href="${escapeHtml(approveUrl.href)}">Approve</a>
<a class="btn deny" role="button" href="${escapeHtml(denyUrl.href)}">Deny</a>
</div>
</div>
<script>
// Anchors only activate on Enter; role="button" promises Space too.
for (const a of document.querySelectorAll(".btn"))
  a.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); a.click(); }
  });
</script>
</body></html>`);
    return;
  }

  // Per-grant token TTL, requested via `?token_ttl_s=` on the resource
  // indicator (the MCP URL the host is authorizing for). Encoded into the
  // auth code so /token can issue tokens with the requested lifetime.
  const tokenTtl = ttlFromResource(resource);
  const code = await signAuthCode(
    {
      client_id,
      redirect_uri,
      code_challenge,
      code_challenge_method,
      scope,
      ...(tokenTtl !== undefined ? { token_ttl_s: tokenTtl } : {}),
    },
    issuer,
  );
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) redirectUrl.searchParams.set("state", state);
  console.log(
    `[auth] issued code for client_id=${client_id}` +
      (tokenTtl !== undefined ? ` (token_ttl_s=${tokenTtl})` : ""),
  );
  res.redirect(redirectUrl.href);
}

async function handleToken(req: Request, res: Response) {
  const { grant_type, code, code_verifier, refresh_token, resource } = req.body;
  const issuer = resolveIssuer(req);
  const audience = resolvePublicUrl(req).href;

  if (grant_type === "refresh_token") {
    const refreshClaims = await verifyRefreshToken(refresh_token, issuer);
    if (!refreshClaims) {
      console.log(`[auth] refresh rejected (invalid/revoked)`);
      res.status(400).json({
        error: "invalid_grant",
        error_description: "Refresh token invalid or revoked",
      });
      return;
    }
    // Refreshed access tokens keep the grant's requested TTL: prefer the
    // resource indicator on this request, else the TTL carried in the refresh
    // token, else the default.
    const accessTtl =
      ttlFromResource(resource) ??
      refreshClaims.accessTtlSeconds ??
      ACCESS_TOKEN_TTL_SECONDS;
    const access_token = await signAccessToken(
      refreshClaims.sub,
      refreshClaims.scope,
      refreshClaims.sid,
      issuer,
      audience,
      accessTtl,
    );
    console.log(
      `[auth] refreshed access token (sid=${refreshClaims.sid}, ttl=${accessTtl}s)`,
    );
    res.json({
      access_token,
      token_type: "Bearer",
      expires_in: accessTtl,
      scope: refreshClaims.scope,
      refresh_token,
    });
    return;
  }
  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }
  const stored = await verifyAuthCode(code, issuer);
  if (!stored) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "Invalid or expired code",
    });
    return;
  }
  // PKCE verification (challenges are always present — /authorize requires them).
  if (!code_verifier) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "Missing code_verifier",
    });
    return;
  }
  const hash = crypto
    .createHash("sha256")
    .update(code_verifier)
    .digest("base64url");
  if (hash !== stored.code_challenge) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "PKCE verification failed",
    });
    return;
  }
  // RFC 6749 §4.1.3 redirect_uri binding: if the client includes redirect_uri
  // in the token request it must match the one from the authorization request.
  // (OAuth 2.1 clients may omit it and rely on PKCE, which is enforced above.)
  if (req.body.redirect_uri && req.body.redirect_uri !== stored.redirect_uri) {
    res.status(400).json({
      error: "invalid_grant",
      error_description: "redirect_uri does not match authorization request",
    });
    return;
  }
  const scope = stored.scope ?? "read:secret";
  const sid = crypto.randomBytes(16).toString("hex"); // new session per authorization_code grant
  // Per-grant TTL: prefer the resource indicator on this request (RFC 8707),
  // else the TTL encoded in the auth code at /authorize, else the default.
  // Refresh tokens must outlive the access tokens they can mint.
  const accessTtl =
    ttlFromResource(resource) ?? stored.token_ttl_s ?? ACCESS_TOKEN_TTL_SECONDS;
  const refreshTtl = Math.max(REFRESH_TOKEN_TTL_SECONDS, accessTtl);
  const access_token = await signAccessToken(
    "mock-user-123",
    scope,
    sid,
    issuer,
    audience,
    accessTtl,
  );
  const refresh = await signRefreshToken(
    "mock-user-123",
    scope,
    sid,
    issuer,
    refreshTtl,
    accessTtl,
  );
  console.log(
    `[auth] exchanged code → token (client_id=${stored.client_id}, scope=${scope}, sid=${sid}, access_ttl=${accessTtl}s, refresh_ttl=${refreshTtl}s)`,
  );
  res.json({
    access_token,
    token_type: "Bearer",
    expires_in: accessTtl,
    scope,
    refresh_token: refresh,
  });
}

// ─── Elicitation state (module-level — survives across SHTTP requests) ──────
//
// Streamable HTTP creates a fresh McpServer per request, so state must live at
// module scope. This is fine for a single-process demo server; back it with a
// shared store if you deploy multiple instances.

/** elicitationIds the user has completed via /elicitation-callback */
const completedElicitations = new Set<string>();
/** elicit_by_error: remember the last-issued eid so retries can check it */
let lastIssuedElicitationId: string | undefined;

// ─── MCP Server ──────────────────────────────────────────────────────────────

/**
 * Creates a new MCP server instance with tools and resources registered.
 *
 * @param authInfo - Verified Bearer token info, if the request carried one.
 * @param req - The inbound HTTP request (used to resolve the public URL).
 */
export function createServer(authInfo?: AuthInfo, req?: Request): McpServer {
  const server = new McpServer({ name: "Lazy Auth Demo", version: "1.0.0" });

  const buttonUri = "ui://lazy-auth/mcp-app.html";
  registerAppTool(
    server,
    "show_auth_button",
    {
      title: "Show Auth Button",
      description:
        "Public tool: shows a button that triggers the protected get_secret tool.",
      inputSchema: {},
      _meta: { ui: { resourceUri: buttonUri } },
    },
    async (): Promise<CallToolResult> => ({
      content: [{ type: "text", text: "ok" }],
    }),
  );
  registerAppResource(
    server,
    buttonUri,
    buttonUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "mcp-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: buttonUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  const secretUri = "ui://lazy-auth/secret-app.html";
  registerAppTool(
    server,
    "get_secret",
    {
      title: "Get Secret",
      description:
        "Protected tool: returns secret data. Requires authentication.",
      inputSchema: {},
      _meta: { ui: { resourceUri: secretUri } },
    },
    async (): Promise<CallToolResult> => {
      if (!authInfo) {
        return {
          isError: true,
          content: [{ type: "text", text: "Authentication required." }],
        };
      }
      const secret = {
        subject: authInfo.sub,
        secret: "the-answer-is-42",
        issuedAt: new Date().toISOString(),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(secret, null, 2) }],
      };
    },
  );
  registerAppResource(
    server,
    secretUri,
    secretUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(
        path.join(DIST_DIR, "secret-app.html"),
        "utf-8",
      );
      return {
        contents: [
          { uri: secretUri, mimeType: RESOURCE_MIME_TYPE, text: html },
        ],
      };
    },
  );

  server.registerTool(
    "revoke_auth_token",
    {
      title: "Revoke Auth Token",
      description:
        "Protected tool: revokes the caller's entire auth session (access + refresh token).",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      if (!authInfo) {
        return {
          isError: true,
          content: [{ type: "text", text: "Authentication required." }],
        };
      }
      revokeSession(authInfo.sid);
      console.log(
        `[auth] revoked session sid=${authInfo.sid} (total revoked sessions: ${revokedSids.size})`,
      );
      return {
        content: [
          {
            type: "text",
            text: `Session revoked (sid: ${authInfo.sid}). Access + refresh token invalid → full re-auth required.`,
          },
        ],
      };
    },
  );

  // ── Elicitation test tools ────────────────────────────────────────────────
  // Public tools — no auth. Used to exercise a host's URL-elicitation flow
  // end-to-end over Streamable HTTP.

  const base = publicBaseHref(req);
  const callbackUrl = (eid: string) =>
    `${base}/elicitation-callback?id=${encodeURIComponent(eid)}`;

  server.registerTool(
    "elicit_url",
    {
      title: "Elicit URL (session-callback)",
      description:
        "URL elicitation via elicitInput. Blocks until the client accepts; sends ElicitCompleteNotification before returning.",
      inputSchema: {},
    },
    async (_args, extra): Promise<CallToolResult> => {
      const eid = crypto.randomUUID();
      // Defer notifier creation — checks client capabilities which throws if
      // client doesn't advertise elicitation. Create lazily after elicitInput
      // succeeds (implies client supports it).
      console.log(`[elicit_url] eid=${eid} — blocking on elicitInput`);
      const result = await server.server.elicitInput(
        {
          mode: "url",
          url: callbackUrl(eid),
          message: "Please open this URL to continue.",
          elicitationId: eid,
        },
        { relatedRequestId: extra.requestId, timeout: 300_000 },
      );
      // Send completion notification before returning — lands on the same SSE
      // stream as this tool response. For Streamable HTTP this is the ONLY
      // window where the server can push a notification (stream closes right
      // after). The notification is optional per spec — skip if the client
      // doesn't support it.
      try {
        const notifier = server.server.createElicitationCompletionNotifier(eid);
        await notifier();
        console.log(
          `[elicit_url] eid=${eid} — notified, result=${result.action}`,
        );
      } catch (e) {
        console.log(
          `[elicit_url] eid=${eid} — notify skipped: ${e instanceof Error ? e.message : e}, result=${result.action}`,
        );
      }
      return {
        content: [
          { type: "text", text: `elicit_url: ${JSON.stringify(result)}` },
        ],
      };
    },
  );

  server.registerTool(
    "elicit_by_error",
    {
      title: "Elicit by -32042 Error",
      description:
        "Throws UrlElicitationRequiredError (-32042). Client must open the URL, then retry. On retry, if the last-issued elicitationId was completed, sends ElicitCompleteNotification and succeeds.",
      inputSchema: {},
    },
    async (): Promise<CallToolResult> => {
      // Retry path: check if the user completed the elicitation we last issued.
      // Module-level state survives across Streamable HTTP requests in a single
      // process. Checking ANY completed eid (not just last-issued) would be more
      // forgiving, but last-issued is the stricter real-world pattern hosts must
      // handle.
      if (
        lastIssuedElicitationId &&
        completedElicitations.has(lastIssuedElicitationId)
      ) {
        const eid = lastIssuedElicitationId;
        completedElicitations.delete(eid);
        lastIssuedElicitationId = undefined;
        // Send notification DURING this (retry) tool call — only window where
        // the Streamable HTTP stream is open. The notification is optional per
        // spec — createElicitationCompletionNotifier throws if the client
        // doesn't advertise the capability, but the tool still succeeds.
        try {
          const notifier =
            server.server.createElicitationCompletionNotifier(eid);
          await notifier();
          console.log(
            `[elicit_by_error] eid=${eid} — completed on retry, notified`,
          );
        } catch (e) {
          console.log(
            `[elicit_by_error] eid=${eid} — completed on retry, notify skipped: ${e instanceof Error ? e.message : e}`,
          );
        }
        return {
          content: [
            {
              type: "text",
              text: `Auth completed (${eid}). Tool succeeded on retry.`,
            },
          ],
        };
      }
      const eid = crypto.randomUUID();
      lastIssuedElicitationId = eid;
      console.log(`[elicit_by_error] eid=${eid} — throwing -32042`);
      throw new UrlElicitationRequiredError([
        {
          mode: "url",
          url: callbackUrl(eid),
          message:
            "This tool requires authentication. Please open the link to continue.",
          elicitationId: eid,
        },
      ]);
    },
  );

  return server;
}

// ─── Express app ─────────────────────────────────────────────────────────────

/**
 * Creates the Express app: OAuth endpoints, discovery metadata, and the /mcp
 * endpoint with lazy (401-triggered) auth on protected tools.
 */
export function createApp(): Express {
  const app = express();
  // Wildcard CORS is deliberate: browser-based MCP hosts connect to this demo
  // from arbitrary origins and must read WWW-Authenticate to drive the lazy
  // auth flow. There are no cookies or ambient credentials to protect — all
  // auth is an explicit Bearer header, and /token is a credential-less PKCE
  // exchange — so cross-origin reads expose nothing a direct request wouldn't.
  app.use(cors({ exposedHeaders: ["WWW-Authenticate"] }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Request tracing: log every inbound request (incl. query params) so we can
  // see what hosts probe during connect and what they send through OAuth.
  app.use((req, _res, next) => {
    const ua = (req.headers["user-agent"] ?? "").slice(0, 80);
    const auth = req.headers.authorization ? "[Bearer]" : "[no-auth]";
    const query = Object.keys(req.query).length
      ? ` query=${JSON.stringify(req.query)}`
      : "";
    console.log(`[req] ${req.method} ${req.path} ${auth}${query} ua=${ua}`);
    next();
  });

  // OAuth endpoints
  app.get("/authorize", handleAuthorize);
  app.post("/token", handleToken);

  // OAuth discovery metadata. In REACTIVE_AUTH_ONLY mode, PRM + AS are kept off the
  // ROOT /.well-known paths so MCP hosts can't proactively probe them and trigger
  // preemptive auth during connection — discovery is purely reactive:
  // 401 → WWW-Authenticate → PRM → AS → OAuth flow.
  const PRM_PATH = "/auth/prm";

  function buildAsMetadata(req: Request) {
    const base = publicBaseHref(req);
    return {
      issuer: resolveIssuer(req), // subpath issuer → well-known at /.well-known/.../auth
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["read:secret"],
      client_id_metadata_document_supported: true,
    };
  }

  // AS metadata: serve at the issuer's well-known location.
  // - REACTIVE_AUTH_ONLY: only at /.well-known/.../auth (subpath); root 404s.
  // - Default: also at root /.well-known/... (standard; some hosts probe this on connect).
  if (ISSUER_SUFFIX) {
    // Per RFC 8414 §3: issuer <host>/auth → /.well-known/oauth-authorization-server/auth
    app.get(
      `/.well-known/oauth-authorization-server${ISSUER_SUFFIX}`,
      (req, res) => res.json(buildAsMetadata(req)),
    );
    // RFC 8615 style (well-known between host and path):
    app.get(
      `${ISSUER_SUFFIX}/.well-known/oauth-authorization-server`,
      (req, res) => res.json(buildAsMetadata(req)),
    );
  }
  if (!REACTIVE_AUTH_ONLY) {
    // Default mode: full AS metadata at root well-known (standard).
    app.get("/.well-known/oauth-authorization-server", (req, res) =>
      res.json(buildAsMetadata(req)),
    );
  }

  // PRM: full version at custom path (referenced via WWW-Authenticate on 401).
  function buildPrm(req: Request, includeAuth: boolean, resourcePath = "/mcp") {
    const base = publicBaseHref(req);
    return {
      resource: `${base}${resourcePath}`,
      ...(includeAuth
        ? {
            authorization_servers: [resolveIssuer(req)],
            scopes_supported: ["read:secret"],
            bearer_methods_supported: ["header"],
          }
        : {}),
    };
  }
  /** Resource path for a TTL-scoped MCP endpoint, validating the TTL segment. */
  function ttlResourcePath(rawTtl: string): string | undefined {
    const ttl = parseTtlSeconds(rawTtl);
    return ttl !== undefined ? `/ttl/${ttl}/mcp` : undefined;
  }
  app.get(PRM_PATH, (req, res) => res.json(buildPrm(req, true)));
  app.get(`${PRM_PATH}/ttl/:ttl`, (req, res) => {
    const resourcePath = ttlResourcePath(String(req.params.ttl));
    if (!resourcePath) {
      res.status(404).json({ error: "invalid_ttl" });
      return;
    }
    res.json(buildPrm(req, true, resourcePath));
  });
  // Root + path-dependent well-known PRM: in REACTIVE mode these 404 so hosts don't
  // interpret their presence as "server has OAuth". In default mode, full PRM.
  if (!REACTIVE_AUTH_ONLY) {
    app.get("/.well-known/oauth-protected-resource", (req, res) =>
      res.json(buildPrm(req, true)),
    );
    app.get("/.well-known/oauth-protected-resource/mcp", (req, res) =>
      res.json(buildPrm(req, true)),
    );
    // Well-known PRM for TTL-scoped MCP endpoints (RFC 9728 derives this URL
    // from the resource path, so each TTL path has its own).
    app.get(
      "/.well-known/oauth-protected-resource/ttl/:ttl/mcp",
      (req, res) => {
        const resourcePath = ttlResourcePath(String(req.params.ttl));
        if (!resourcePath) {
          res.status(404).json({ error: "invalid_ttl" });
          return;
        }
        res.json(buildPrm(req, true, resourcePath));
      },
    );
  }

  // /register: some MCP hosts fall through to OAuth dynamic client registration (RFC 7591)
  // when all well-known probes 404. We don't support it — return a proper OAuth error so
  // the host concludes "auth not available here" and connects without OAuth, instead of
  // treating a generic 404 as a connection failure.
  app.post("/register", (_req, res) => {
    res.status(400).json({
      error: "invalid_request",
      error_description:
        "Dynamic client registration is not supported. This server uses per-tool auth triggered via WWW-Authenticate on 401.",
    });
  });

  // MCP endpoint handler, shared by the default and TTL-scoped paths.
  // pathTtl (from /ttl/<seconds>/mcp) doubles as the acceptance window for
  // Bearer tokens: tokens older than it are rejected even if their issued
  // lifetime was longer.
  async function handleMcp(
    req: Request,
    res: Response,
    pathTtl: number | undefined,
  ) {
    const base = publicBaseHref(req);
    const resourceMetadataUrl =
      pathTtl !== undefined
        ? `${base}${PRM_PATH}/ttl/${pathTtl}`
        : `${base}${PRM_PATH}`;

    const body = req.body;
    const messages = Array.isArray(body) ? body : body ? [body] : [];
    const needsAuth = messages.some(
      (msg: { method?: string; params?: { name?: string } }) =>
        msg?.method === "tools/call" &&
        PROTECTED_TOOLS.has(msg.params?.name ?? ""),
    );

    // Acceptance window: the path TTL, else the `?token_ttl_s=` query param
    // (fallback for clients that preserve query strings).
    const tokenMaxAgeSeconds =
      pathTtl ?? parseTtlSeconds(String(req.query.token_ttl_s ?? ""));

    let authInfo: AuthInfo | undefined;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      authInfo = await verifyAccessToken(
        authHeader.slice(7),
        resolveIssuer(req),
        tokenMaxAgeSeconds,
      );
      if (!authInfo && needsAuth) {
        console.log(`[mcp] 401: invalid token for protected tool`);
        res
          .status(401)
          .set(
            "WWW-Authenticate",
            `Bearer error="invalid_token", error_description="The access token is invalid", resource_metadata="${resourceMetadataUrl}"`,
          )
          .json({
            error: "invalid_token",
            error_description: "The access token is invalid",
          });
        return;
      }
    } else if (needsAuth) {
      console.log(`[mcp] 401: no token for protected tool`);
      res
        .status(401)
        .set(
          "WWW-Authenticate",
          `Bearer resource_metadata="${resourceMetadataUrl}"`,
        )
        .json({
          error: "invalid_token",
          error_description: "Authorization required",
        });
      return;
    }

    const server = createServer(authInfo, req);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[mcp] Error:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  }

  // Default MCP endpoint (default token TTLs).
  app.all("/mcp", (req: Request, res: Response) =>
    handleMcp(req, res, undefined),
  );
  // TTL-scoped MCP endpoint: tokens for connections made through this path are
  // issued with (and limited to) the requested lifetime, e.g. /ttl/3600/mcp.
  app.all("/ttl/:ttl/mcp", (req: Request, res: Response) => {
    const pathTtl = parseTtlSeconds(String(req.params.ttl));
    if (pathTtl === undefined) {
      res.status(404).json({ error: "invalid_ttl" });
      return;
    }
    return handleMcp(req, res, pathTtl);
  });

  // Elicitation callback — marks an eid as completed. Module-level state;
  // the next elicit_by_error retry reads it. Minimal confirmation page so
  // the popup shows something.
  app.get("/elicitation-callback", (req, res) => {
    const id = String(req.query.id ?? "");
    if (!id) {
      res.status(400).type("text/plain").send("missing ?id=");
      return;
    }
    completedElicitations.add(id);
    console.log(
      `[callback] eid=${id} completed (total: ${completedElicitations.size})`,
    );
    res
      .type("text/html")
      .send(
        `<!doctype html><title>Done</title>` +
          `<body style="font-family:system-ui;padding:2em">` +
          `<h2>✓ Elicitation completed</h2>` +
          `<p><code>${escapeHtml(id)}</code></p>` +
          `<p>You can close this tab. The tool will succeed on the next retry.</p>`,
      );
  });

  // Simple landing page
  app.get("/", (req, res) => {
    const base = publicBaseHref(req);
    res
      .type("text/plain")
      .send(
        `Lazy Auth Demo — MCP server\n\n` +
          `  MCP endpoint:  ${base}/mcp\n` +
          `                 ${base}/ttl/<seconds>/mcp  (custom token TTL, e.g. /ttl/3600/mcp)\n` +
          `  AS metadata:   ${base}/.well-known/oauth-authorization-server${ISSUER_SUFFIX}\n` +
          `  PRM metadata:  ${base}${PRM_PATH}\n\n` +
          `Tools:\n` +
          `  - show_auth_button  (public)\n` +
          `  - get_secret        (protected, requires Bearer token)\n` +
          `  - revoke_auth_token (protected, revokes caller's auth session)\n` +
          `  - elicit_url        (public, URL elicitation via elicitInput)\n` +
          `  - elicit_by_error   (public, URL elicitation via -32042 error)\n`,
      );
  });

  return app;
}
