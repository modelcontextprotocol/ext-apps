/**
 * `prepare` lifecycle script.
 *
 * npm runs `prepare` on every `npm install`, including when someone installs a
 * single workspace example via `npm install` inside `examples/<name>`. That flow
 * installs only that workspace's dependencies and does NOT install the root
 * package's devDependencies (ts-to-zod, bun, tsx, esbuild, husky, ...), yet npm
 * still runs this root `prepare`. Running the build there used to fail with a
 * cryptic `ERR_MODULE_NOT_FOUND: ts-to-zod`.
 * See https://github.com/modelcontextprotocol/ext-apps/issues/687.
 *
 * We detect a missing build toolchain and skip the build with a helpful message
 * instead of crashing. Registry consumers are unaffected: `prepare` does not run
 * for published packages and `dist/` ships in the tarball. Git installs still
 * build, because npm installs a git dependency's devDependencies before running
 * its `prepare`.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Root-only devDependencies that `npm run build` needs. If any is missing we are
// in a partial install (e.g. a workspace-child install) that cannot build.
const REQUIRED_TOOLING = ["ts-to-zod", "bun", "tsx"];

const missing = REQUIRED_TOOLING.filter((pkg) => {
  try {
    require.resolve(`${pkg}/package.json`);
    return false;
  } catch {
    return true;
  }
});

if (missing.length > 0) {
  console.log(
    `[prepare] Skipping SDK build: missing build tooling (${missing.join(", ")}).`,
  );
  console.log(
    "[prepare] This is expected when installing a single example. To build the " +
      "SDK and run the examples, run `npm install` from the repository root.",
  );
  process.exit(0);
}

execSync("npm run build", { stdio: "inherit" });

// Install git hooks (husky). Best-effort: never fail the install if husky cannot
// run (e.g. when installing outside a git checkout).
try {
  execSync("husky", { stdio: "inherit" });
} catch {
  // husky is optional for local development; ignore failures.
}
