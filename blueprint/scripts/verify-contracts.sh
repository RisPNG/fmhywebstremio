#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/.verify-contracts-build"
trap 'rm -rf "$BUILD"' EXIT INT TERM

cd "$ROOT"
rm -rf "$BUILD"
if [ -x ./node_modules/.bin/tsc ]; then
  TSC=./node_modules/.bin/tsc
elif command -v tsc >/dev/null 2>&1; then
  TSC=$(command -v tsc)
else
  echo "TypeScript compiler not found. Run npm install first." >&2
  exit 1
fi

"$TSC" -p tsconfig.verify.json --outDir "$BUILD"

node - "$BUILD/engine/core/testing/synthetic-extractor.js" <<'NODE'
const modulePath = process.argv[2];
const { SyntheticExtractor, describeExtractionResult } = require(modulePath);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const extractor = new SyntheticExtractor();
const services = { request: async () => { throw new Error("synthetic extractor must not request network"); } };
const signal = new AbortController().signal;

(async () => {
  const cases = [
    ["streams", "streams:1"],
    ["redirect", "redirect:synthetic://fixture/streams"],
    ["embeds", "embeds:1"],
    ["empty", "empty:no-streams"],
    ["failure", "failure:NO_STREAM_CANDIDATE"],
  ];

  for (const [path, expected] of cases) {
    const result = await extractor.extract({ url: new URL(`synthetic://fixture/${path}`) }, services, signal);
    assert(describeExtractionResult(result) === expected, `${path} variant was not handled exhaustively`);
  }

  console.log("core contract checks passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
