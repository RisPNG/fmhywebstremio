#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
BUILD="$ROOT/.verify-build"
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

"$TSC" -p tsconfig.verify.json

node - "$BUILD/engine/core/models/failures.js" <<'NODE'
const failuresPath = process.argv[2];
const { captureDiagnostic } = require(failuresPath);
const enc = new TextEncoder();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const mixedCaseHeader = captureDiagnostic(
  { status: 200, headers: { "Content-Type": "text/html" } },
  { maxBytes: 16 },
);
assert(mixedCaseHeader.contentType === "text/html", "mixed-case Content-Type was lost");
assert(mixedCaseHeader.sensitivity === "privileged", "diagnostics must be privileged");

const signedUrls = captureDiagnostic(
  {
    finalUrl: new URL("https://user:pass@cdn.example/v.m3u8?token=SECRET123&exp=999#frag"),
    redirectChain: [new URL("https://a.example/e?auth=hunter2")],
  },
  { maxBytes: 16 },
);
assert(signedUrls.finalUrl === "https://cdn.example/v.m3u8?token=&exp=", "final URL shape/redaction is wrong");
assert(signedUrls.redirectChain?.[0] === "https://a.example/e?auth=", "redirect URL shape/redaction is wrong");


const preservedSlug = captureDiagnostic(
  { finalUrl: new URL("https://cdn.example/watch/spiderman2099/master.m3u8") },
  { maxBytes: 16 },
);
assert(
  preservedSlug.finalUrl === "https://cdn.example/watch/spiderman2099/master.m3u8",
  "human-readable path slug was over-redacted",
);

const preservedBase64UrlLike = captureDiagnostic(
  { finalUrl: new URL("https://cdn.example/hls/abc-def_123XYZ456789/master.m3u8") },
  { maxBytes: 16 },
);
assert(
  preservedBase64UrlLike.finalUrl === "https://cdn.example/hls/abc-def_123XYZ456789/master.m3u8",
  "ambiguous opaque path segment must remain because diagnostics are privileged",
);

const exactUuid = captureDiagnostic(
  { finalUrl: new URL("https://cdn.example/hls/123e4567-e89b-12d3-a456-426614174000/master.m3u8") },
  { maxBytes: 16 },
);
assert(
  exactUuid.finalUrl === "https://cdn.example/hls/{uuid}/master.m3u8",
  "canonical UUID path identifier was not templated",
);

const exactSha1 = captureDiagnostic(
  { finalUrl: new URL("https://cdn.example/hls/0123456789abcdef0123456789abcdef01234567/master.m3u8") },
  { maxBytes: 16 },
);
assert(
  exactSha1.finalUrl === "https://cdn.example/hls/{sha1}/master.m3u8",
  "canonical SHA1-like path identifier was not templated",
);

const matrixParam = captureDiagnostic(
  { finalUrl: new URL("https://ex.example/e/;jsessionid=SECRET/play") },
  { maxBytes: 16 },
);
assert(
  matrixParam.finalUrl === "https://ex.example/e/;jsessionid={redacted}/play",
  "matrix/path parameter value was not redacted",
);

const duplicateQuery = captureDiagnostic(
  { finalUrl: new URL("https://cdn.example/v.m3u8?a=1&a=2&token=x") },
  { maxBytes: 16 },
);
assert(
  duplicateQuery.finalUrl === "https://cdn.example/v.m3u8?a=&a=&token=",
  "duplicate query parameter names were not preserved",
);

const utf8 = captureDiagnostic(
  { body: enc.encode("Película") },
  { maxBytes: 4 },
);
assert(utf8.bodySample === "Pel", "UTF-8 byte-cap boundary produced a damaged sample");
assert(utf8.bodyTruncated === true, "truncation flag was not set");

const windows1252 = captureDiagnostic(
  {
    headers: { "content-type": "text/html; charset=windows-1252" },
    body: Uint8Array.from([0x50, 0x65, 0x6c, 0xed, 0x63, 0x75, 0x6c, 0x61]),
  },
  { maxBytes: 16 },
);
assert(
  windows1252.bodySample === "Película" || windows1252.bodySample === "Pel�cula",
  "declared charset handling violated the documented decoder/fallback contract",
);

const embeddedSecret = captureDiagnostic(
  { body: enc.encode('<script>var f={"file":"https://cdn/x.m3u8?token=SECRET123"}</script>') },
  { maxBytes: 256 },
);
assert(embeddedSecret.bodySample.includes("SECRET123"), "test fixture changed: body samples are privileged, not scrubbed");

const emptyBody = captureDiagnostic(
  { status: 200, body: new Uint8Array() },
  { maxBytes: 16 },
);
assert(emptyBody.bodyCaptured === true, "empty body was mistaken for uncaptured body");
assert(emptyBody.bodyBytes === 0, "empty body byte count is wrong");
assert(emptyBody.bodySample === "", "empty captured body must retain an empty sample");
assert(emptyBody.bodyTruncated === false, "empty body must not be marked truncated");

console.log("diagnostic regression checks passed");
NODE
