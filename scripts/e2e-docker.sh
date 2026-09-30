#!/bin/sh
# Runs the Playwright e2e suite in the same image CI uses (screenshots are only
# comparable on Linux). Extra arguments are passed to `playwright test`, e.g.
#   scripts/e2e-docker.sh --update-snapshots
#   GENERATE_SCREENSHOTS=1 scripts/e2e-docker.sh tests/e2e/generate-grid-screenshots.spec.ts
#
# The repo is bind-mounted so snapshots and screenshots are written back to the
# host, but every node_modules directory is shadowed by an anonymous volume: the
# container's `npm ci` installs Linux binaries and would otherwise replace the
# host's node_modules with them.
set -eu
cd "$(dirname "$0")/.."

mounts="-v /work/node_modules"
for dir in examples/*/; do
  mounts="$mounts -v /work/${dir}node_modules"
done

# `-t` needs a terminal; without one (CI, agents) docker refuses to start.
tty=""
if [ -t 0 ] && [ -t 1 ]; then tty="-it"; fi

# shellcheck disable=SC2086 # word splitting of $tty and $mounts is intended
exec docker run --rm $tty -e EXAMPLE -e GENERATE_SCREENSHOTS \
  -v "$PWD:/work" $mounts -w /work \
  mcr.microsoft.com/playwright:v1.57.0-noble \
  sh -c 'apt-get update -qq &&
    apt-get install -qq -y python3-venv curl > /dev/null &&
    curl -LsSf https://astral.sh/uv/install.sh | sh &&
    export PATH="$HOME/.local/bin:$PATH" &&
    npm i -g bun &&
    npm ci &&
    npx playwright test "$@"' sh "$@"
