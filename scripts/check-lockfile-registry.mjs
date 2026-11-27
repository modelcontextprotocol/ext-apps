#!/usr/bin/env node
/**
 * Checks that package-lock.json only references the public npm registry.
 *
 * Why: contributors and CI may have a corporate proxy registry configured
 * (e.g. via `~/.npmrc` or `npm_config_registry`). npm records the registry it
 * resolved against in each entry's `resolved` field. Committing those URLs
 * leaks an internal hostname, breaks installs for everyone else, and can
 * record a different `integrity` digest than the public registry would.
 *
 * Usage:
 *   node scripts/check-lockfile-registry.mjs          # check (exit 1 on leak)
 *   node scripts/check-lockfile-registry.mjs --fix    # rewrite leaked entries
 *                                                     #   from registry.npmjs.org
 *
 * `--fix` looks up each offending `<name>@<version>` on registry.npmjs.org and
 * rewrites the entry's `resolved` / `integrity` to the public registry's
 * canonical values, then re-stringifies the lockfile with npm's two-space
 * indentation. It is safe to run after `npm install <pkg>` against a proxy.
 *
 * Run automatically by `.husky/pre-commit` and CI.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const LOCKFILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "package-lock.json",
);

const fix = process.argv.includes("--fix");

let raw;
try {
  raw = readFileSync(LOCKFILE, "utf8");
} catch {
  // No lockfile (fresh clone before install) — nothing to check.
  process.exit(0);
}
const lock = JSON.parse(raw);

/** @type {{ path: string, name: string, version: string, pkg: any }[]} */
const offenders = [];
for (const [path, pkg] of Object.entries(lock.packages ?? {})) {
  if (!path || !pkg.resolved) continue; // root / workspace member
  if (!/^https?:\/\//.test(pkg.resolved)) continue; // git, file, link…
  if (pkg.resolved.startsWith(PUBLIC_REGISTRY)) continue;
  const name = path.replace(/^.*node_modules\//, "");
  offenders.push({ path, name, version: pkg.version, pkg });
}

if (offenders.length === 0) process.exit(0);

if (!fix) {
  console.error(
    `package-lock.json references ${offenders.length} non-public registry URL(s):\n`,
  );
  for (const { name, version, pkg } of offenders.slice(0, 20)) {
    console.error(`  ${name}@${version}\n    ${pkg.resolved}`);
  }
  if (offenders.length > 20)
    console.error(`  … and ${offenders.length - 20} more`);
  console.error(`
This usually means a dependency was added while a corporate proxy registry was
configured (~/.npmrc, npm_config_registry, etc.). Public lockfiles must only
reference ${PUBLIC_REGISTRY} so they're reproducible and don't leak internal
hostnames.

To fix:
  node scripts/check-lockfile-registry.mjs --fix
  git add package-lock.json
`);
  process.exit(1);
}

// --fix: rewrite each offending entry from registry.npmjs.org metadata.
const fetchMeta = async (name, version) => {
  const url = `${PUBLIC_REGISTRY}${name.replaceAll("/", "%2f")}/${version}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `${name}@${version}: ${res.status} ${res.statusText} from ${PUBLIC_REGISTRY} — ` +
        `not a public package? It can't be referenced from a public lockfile.`,
    );
  }
  return /** @type {{ dist: { tarball: string, integrity?: string, shasum?: string } }} */ (
    await res.json()
  );
};

let failed = false;
for (const { name, version, pkg } of offenders) {
  let dist;
  try {
    ({ dist } = await fetchMeta(name, version));
  } catch (err) {
    console.error(String(err));
    failed = true;
    continue;
  }
  const integrity =
    dist.integrity ??
    (dist.shasum
      ? `sha1-${Buffer.from(dist.shasum, "hex").toString("base64")}`
      : undefined);
  if (!integrity) {
    console.error(
      `${name}@${version}: no integrity from registry; fix manually.`,
    );
    failed = true;
    continue;
  }
  pkg.resolved = dist.tarball;
  pkg.integrity = integrity;
  console.log(`fixed ${name}@${version}`);
}

if (failed) process.exit(1);
writeFileSync(LOCKFILE, JSON.stringify(lock, null, 2) + "\n");
console.log("package-lock.json sanitized.");
