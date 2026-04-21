/**
 * Workaround: npm workspaces don't symlink the root package into node_modules
 * when child workspaces depend on it — it installs a stale registry copy instead.
 * This script syncs the freshly-built dist/ and package.json into that copy
 * so examples always type-check against the latest local types.
 * See: https://github.com/npm/feedback/discussions/774
 */
import { cpSync, existsSync, lstatSync } from "fs";

const target = "node_modules/@modelcontextprotocol/ext-apps";
if (!existsSync(target)) process.exit(0);
// If target is a symlink (e.g. to the repo root), dist is already current.
if (lstatSync(target).isSymbolicLink()) process.exit(0);

cpSync("dist", `${target}/dist`, { recursive: true });
cpSync("package.json", `${target}/package.json`);
