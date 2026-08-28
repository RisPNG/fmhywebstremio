# WebStreamrMBG Fork Implementation Plan

## Purpose

This plan is for working **inside a fork of `newman2x/WebStreamrMBG`**. The main product is the deployed Stremio addon. Preserve the Stremio shell while replacing extraction internals in-place.

FMHY is the concrete maintained directory used to discover candidate streaming sites. FMHY is not treated as proof that a site is supported, and it does not tell the engine how to search an arbitrary newly listed site for a movie or episode. New domains become automatically usable only when they match a source family the addon already understands.

Do not organize this work as named versions or phases. Use one ordering rule:

> **Always preserve one working end-to-end path from Stremio request -> source family -> host extractor -> validated stream -> Stremio response, and add infrastructure only when the next real integration requires it.**

The ordered checklist below is the dependency spine.

---

## Working Repository Baseline

- Fork `newman2x/WebStreamrMBG`.
- Preserve upstream license/attribution obligations.
- Give the fork a unique Stremio manifest ID/name.
- Build and run the upstream fork unchanged first.
- Verify its manifest/configuration endpoint.
- Deploy the unchanged fork to an HTTPS endpoint.
- Install that endpoint in Stremio and verify an addon request reaches the server.
- Record the deployment procedure in the repository.
- Keep that known-good deployment path working throughout the refactor.

The repository should never enter a state where the only way to test extraction is through a disconnected experimental framework.

---

## Implementation Order

### 1. Isolate the Stremio adapter

Move Stremio-specific request parsing and response mapping behind a narrow boundary.

Target:

```text
Stremio route
    -> MediaRequest
    -> StreamEngine
    -> NormalizedStream[]
    -> Stremio response
```

Do not move extractor logic into the adapter.

Completion test:

- existing addon route still works;
- existing behavior can call through the adapter boundary;
- engine internals no longer need Stremio route objects.

### 2. Introduce the core tagged contracts

Add:

- `MediaIdentity`;
- `SourceRecord`;
- `ExtractionTarget`;
- `Extractor`;
- `MatchResult`;
- `ExtractionResult` tagged union;
- `StreamCandidate`;
- typed `Failure`/`FailureCode`.

Keep the extractor API tiny. Do not introduce a base class with convenience methods.

Completion test:

- one synthetic extractor returns all five result variants: `streams`, `redirect`, `embeds`, `empty`, and `failure`;
- an exhaustive `switch` over `ExtractionResult` is compiled and exercised by `npm run verify:contracts`;
- TypeScript exhaustiveness checks require every result tag to be handled.

### 3. Build the resolver

The resolver owns:

- matcher lookup;
- extractor invocation;
- recursion;
- cycle detection;
- configurable depth guard;
- cancellation;
- partial-result accumulation.

Extractors must never directly call another extractor.

Completion test:

```text
synthetic source
    -> embed target
        -> synthetic host
            -> StreamCandidate
```

works entirely through resolver-owned delegation.

### 4. Build one source-family path

Choose one authorized/testable source architecture already understood by the fork and express it as a `SourceFamily`.

The family should do only the site-specific work required to locate a requested media item and emit downstream targets.

Completion test:

```text
MediaIdentity
    -> SourceFamily
    -> EmbedsResult / RedirectResult
```

with deterministic fixture tests.

### 5. Build one host extractor

Take one embed/provider used by the chosen source-family path and implement it as an independent host extractor.

Completion test:

```text
embed target
    -> HostExtractor
    -> StreamCandidate(.m3u8 or equivalent)
```

The source family should not contain the host's parsing logic.

### 6. Add HLS inspection and fresh validation

Implement only what the addon needs to return a trustworthy HLS result:

- fetch master/media manifest as appropriate;
- parse available variants;
- extract resolution/bandwidth/codecs when present;
- verify the manifest is structurally usable now;
- produce `NormalizedStream`.

Do not build a segment downloader unless the addon actually needs to proxy media.

Completion test:

```text
Stremio request
    -> source family
    -> host extractor
    -> HLS inspector
    -> validated NormalizedStream
    -> Stremio response
```

This is the permanent vertical slice. Keep it working from this point onward.

### 7. Make partial-result semantics explicit

Implement a hard request deadline and cancellation.

Rules:

- successful sources contribute results immediately to the query accumulator;
- one source failure does not fail the query;
- at the deadline, cancel outstanding work;
- return all valid accumulated streams after dedup/order;
- report total failure only when zero valid streams exist.

Add tests with mixed success/failure/timeout sources.

### 8. Add the matcher registry

Create constrained extractor metadata and generate `registry.generated.ts`.

Requirements:

- commit the generated registry;
- deterministic generator output;
- CI regenerates and requires no diff;
- lazy import the winning extractor where practical;
- matcher priority/specificity prevents generic fallback shadowing.

Add declarative positive/negative matcher tests and a shared cross-extractor collision corpus.

### 9. Add the TransportDirector

Move network policy behind `RequestServices.request()` and a transport director.

Start with ordinary HTTP only unless a real integration requires something else.

The transport layer owns:

- redirect handling;
- retry policy;
- timeout behavior;
- content-type expectations;
- response header names normalized to lowercase at the transport boundary;
- diagnostic URLs sanitized by default: no userinfo or fragment, and query parameter names retained with values redacted;
- bounded privileged diagnostic bodies that distinguish uncaptured from captured-empty responses, honor declared charset with UTF-8 fallback, and truncate safely at byte boundaries;

- SSRF checks before connection, after DNS resolution, and after redirects;
- typed transport failures;
- cookie/request-state jars keyed by an explicit `stateScope` on `ExtractionRequest` (`query`, `source`, or `host`).

Do not use a process-global cookie jar. A full session pool can remain deferred; explicit ownership cannot.

Use configurable global and per-host semaphores. Do not add adaptive CPU/memory pressure control without production evidence.

### 10. Add FMHY ingestion

Implement `FmhyDirectoryProvider` as the concrete directory source.

Repository references:

- `https://github.com/fmhy/FMHY/wiki/Backups`
- `https://github.com/fmhy/edit`
- `https://fmhy.net/video` for human inspection

Prefer the current official raw/machine-consumable representation exposed through FMHY's source/backups material. Treat it as human-curated external input, not a stable versioned API contract.

Implement:

- fetch;
- parse;
- normalize;
- relevant video/stream section selection;
- mirror/domain normalization;
- deterministic snapshots;
- diff against last known snapshot;
- parser fixtures;
- last-known-good fallback.

Directory failures must be typed:

```text
DIRECTORY_FETCH_FAILED
DIRECTORY_FORMAT_CHANGED
DIRECTORY_ENTRY_INVALID
DIRECTORY_CATEGORY_MISSING
DIRECTORY_PARSE_PARTIAL
```

If a new FMHY snapshot cannot be parsed/validated, keep serving the previous valid local registry.

### 11. Introduce the local source registry

Each FMHY candidate receives local state separate from FMHY metadata.

Minimum state:

```text
UNKNOWN
SUPPORTED
DEGRADED
UNSUPPORTED
DISABLED
```

Track this with the canonical `SourceRecord` in `src/engine/core/models/source.ts`. The implementation must use that single model for domain identity, FMHY provenance, family assignment/confidence/evidence, and local status.

Also persist the last health outcome and recent success/failure history separately or alongside the record as the chosen storage model requires.

A new FMHY domain begins `UNKNOWN`.

### 12. Add source-family recognition from one shared bounded snapshot

Do not classify family membership from domain, FMHY tags, or registry metadata alone, and do not let every family fetch the same candidate independently. For each FMHY candidate, the probe runner performs one bounded recognition attempt:

```text
candidate source
    -> one fetch/inspection under ProbeBudget
    -> SourceProbeSnapshot
    -> run all known SourceFamily.classify() functions locally
    -> central arbitration
        -> winner clears minimum confidence + runner-up margin: assign family
        -> competing evidence too close: FAMILY_PROBE_AMBIGUOUS
        -> successful probe with no credible family: UNSUPPORTED_SOURCE_PATTERN
```

`ProbeBudget` owns `maxRequests`, `maxBytes`, and `deadlineMs`. Family classifiers are pure over the shared snapshot and may use evidence such as stable asset paths, DOM fingerprints, route shapes, generator metadata, API response shape, and script signatures. Persist the winning family ID, confidence, evidence, and `lastProbedAt` in `SourceRecord`.
Allow per-family confidence/margin overrides only when observed fingerprint stability justifies them; keep global values as conservative defaults.

Add typed probe outcomes for timeout, blocking, network failure, ambiguity, and budget exhaustion. These are retry/review states; do not collapse them into `UNSUPPORTED_SOURCE_PATTERN`, which means a completed confident non-match.

Do not claim that a generic extractor can discover arbitrary title-search semantics for unseen architectures. The automatic-support path is intentionally narrow: mirrors/clones or sites whose architecture is recognizably a family the addon already understands.

### 13. Add positive/negative family probe corpora and three-stage health checks

Before treating live discovery failures as breakage, maintain a small media corpus for each supported source family. Do not probe arbitrary titles and then infer that `MEDIA_NOT_FOUND` means the site is broken.

Minimum corpus model:

```text
family ID
    -> discoverable movie case(s)
    -> discoverable episode case(s), when applicable
    -> absent case(s) where practical
```

Each `FamilyProbeCase.expected` is `"discoverable" | "absent"`. Positive failures use `KNOWN_PROBE_MEDIA_NOT_FOUND` or a more specific parser/transport failure. Negative cases catch search paths that start returning plausible-looking matches for everything.

Apply quorum semantics: degrade a source/family only when the configured majority/quorum of positive cases fails; if one positive case repeatedly fails while the others pass, flag that case itself as potentially stale and queue it for review. An absent case unexpectedly becoming discoverable is an anomaly, not proof of unavailability.

Keep health stages separate:

```text
discovery
extraction
stream validation
```

Examples:

- discovery passes, extraction fails with `UNKNOWN_HOST`;
- discovery/extraction pass, stream validation fails with `STREAM_EXPIRED`;
- source family no longer finds expected search structure -> `PAGE_STRUCTURE_CHANGED`/`SEARCH_FAILED`.

Live health checks should not be the only extractor tests. Keep deterministic fixture tests for parser behavior.

### 14. Record dependency edges

Whenever a source family delegates to an embed/host provider, record the relationship.

You need enough data to answer:

```text
provider-x broke; which FMHY sources depend on it?
```

A database is optional at first; a simple persisted structure is enough. The data model matters more than the UI.

### 15. Add root-cause failure rollup

Group health failures by dependency node and failure code.

Minimum useful report:

```text
UNKNOWN_HOST provider-new.example
  source-a
  source-b
  source-c

HOST_EXTRACTION_FAILED provider-x
  source-d
  source-e
```

A text/JSON report is sufficient. A dashboard can come later if it actually saves maintenance time.

### 16. Add deterministic pre-order, bounded top-K validation, and final ordering

Do not let validation completion order decide quality. First rank candidates using only cheap information already available, then validate a bounded top-K in parallel.

Pre-validation ordering:

1. healthy/reliable source before degraded source;
2. preferred language before other language;
3. preferred protocol/quality metadata before lower-priority alternatives;
4. lower recent extraction latency as a tie-breaker;
5. deterministic source/extractor/URL tie-break.

Select configurable `K`, fresh-validate only those candidates, and attach explicit state: `validated`, `unverified`, or `failed`. Exclude failed candidates. In the final ordering, validated may precede unverified without changing which candidates were selected in the first place.

At the request deadline, return usable partial results with their actual validation state. Promise timing must not affect top-K selection. Collect runtime history before deciding whether a weighted model is useful.

### 17. Add layered deduplication

Do not use normalized hostname as the primary identity.

Use, in increasing cost order:

- exact/canonical candidate URL where valid;
- provider/content identifiers;
- parsed manifest structure: variant ladder, codecs, duration characteristics, segment naming/path patterns.

Structural equivalence means probable duplicate, not absolute identity.

### 18. Broaden source families and host extractors

From this point, growth should mostly be additive:

```text
new source family
new host extractor
new matcher metadata
new fixtures
new dependency edges
```

Every new integration should preserve the permanent vertical slice and the small extractor contract.

Prioritize by impact:

```text
number of affected FMHY candidates
x recent failure/usage relevance
```

rather than by raw source count.

---

## Failure Taxonomy to Implement

Use a typed enum/tagged hierarchy. At minimum:

```text
DIRECTORY
  DIRECTORY_FETCH_FAILED
  DIRECTORY_FORMAT_CHANGED
  DIRECTORY_ENTRY_INVALID
  DIRECTORY_CATEGORY_MISSING
  DIRECTORY_PARSE_PARTIAL

NETWORK
  DNS_FAILED
  CONNECTION_FAILED
  TLS_FAILED
  TIMEOUT
  RATE_LIMITED

HTTP
  HTTP_FORBIDDEN
  HTTP_NOT_FOUND
  HTTP_SERVER_ERROR
  REDIRECT_LOOP

CONTENT
  UNEXPECTED_CONTENT_TYPE
  RESPONSE_SCHEMA_CHANGED
  PAGE_STRUCTURE_CHANGED

DISCOVERY
  SEARCH_FAILED
  MEDIA_NOT_FOUND
  KNOWN_PROBE_MEDIA_NOT_FOUND
  EPISODE_NOT_FOUND
  RESULT_MAPPING_FAILED
  FAMILY_PROBE_TIMEOUT
  FAMILY_PROBE_BLOCKED
  FAMILY_PROBE_NETWORK_FAILED
  FAMILY_PROBE_AMBIGUOUS
  FAMILY_PROBE_BUDGET_EXCEEDED
  UNSUPPORTED_SOURCE_PATTERN

EXTRACTION
  EMBED_NOT_FOUND
  UNKNOWN_HOST
  HOST_EXTRACTION_FAILED
  SCRIPT_DATA_MISSING
  NO_STREAM_CANDIDATE
  EXTRACTION_CYCLE
  EXTRACTION_DEPTH_EXCEEDED

PROTOCOL
  MANIFEST_FETCH_FAILED
  MANIFEST_INVALID
  NO_PLAYABLE_VARIANTS
  STREAM_EXPIRED

ENGINE
  EXTRACTOR_EXCEPTION
  CONTRACT_VIOLATION
  INTERNAL_ERROR
```

A failure includes its code, the actual runtime pipeline stage when known, source/family/extractor identity, target host where useful, timestamp, and a bounded `FailureDiagnostic`. The resolver/runtime stamps a prefixed contextual `stage:*`; `categoryOf(code)` provides a distinct prefixed `category:*`, making the two concepts non-cross-assignable in TypeScript. Diagnostics are created through `captureDiagnostic(...)`, which centrally enforces the byte cap. Retry behavior comes from exhaustive `defaultRetryPolicyOf(code): none | immediate | backoff | re-extract | defer`, not a boolean. `TIMEOUT` defaults to `defer`; callers may override defaults by execution context rather than spending a user-query deadline on an automatic second timeout.

`EmptyResult` is only for successful execution with no result (`not-found` or `no-streams`). Unsupported architectures and operational/parser failures are typed `FailureResult` values. `EXTRACTOR_EXCEPTION` and `INTERNAL_ERROR` are excluded from `ExtractorFailureCode`, so extractor-owned failures cannot compile with them; only the resolver/runtime constructs them when wrapping unexpected throws.

---

## Test Harness Requirements

### Matcher tests

Every matcher gets positive and negative cases. The central harness also cross-checks every known URL against all matchers to detect accidental shadowing/collisions.

### Fixture tests

For source families and host extractors, use sanitized deterministic fixtures from authorized targets.

```text
fixture
    -> fake transport
    -> extractor
    -> expected ExtractionResult
```

### Resolver integration tests

At least one full fixture chain must always pass:

```text
SourceFamily fixture
    -> HostExtractor fixture
    -> HLS fixture
    -> NormalizedStream
```

### FMHY parser tests

Keep fixtures that exercise current formatting plus edge cases. When FMHY formatting changes in reality, add the old failure as a regression fixture before updating the parser.

### Family recognition and health-corpus tests

For each supported family, test at least one positive family fingerprint fixture and unrelated negative fixtures. Test confidence/evidence output rather than only a boolean.

Maintain positive/negative health cases separately from parser fixtures so a live probe can distinguish catalog absence, false-positive search behavior, and source breakage.

### Partial-result tests

Simulate:

- one fast success;
- one parser failure;
- one timeout;
- one slow success after deadline.

Assert that the fast valid result is returned and outstanding work is cancelled at the deadline.

---

## Security Requirements

### SSRF

Externally discovered URLs are untrusted. Block private, loopback, link-local, metadata, and configured internal ranges before connection; resolve DNS and check resolved addresses; re-check after redirects.

### Redirect and recursion guards

Set finite redirect count, recursion depth, and visited-target detection.

### Browser/script isolation

If a real authorized integration requires browser execution, keep it behind a transport capability boundary. Do not `eval` arbitrary page script inside the main addon process.

### Secrets

Do not let extractors read arbitrary process environment directly. Add a narrow credentials capability only for integrations that actually require it.

---

## What Not to Build Until Needed

Do not make these prerequisites:

- OpenTelemetry tracing;
- graph dashboard;
- health dashboard;
- admin API;
- elaborate developer CLI;
- adaptive concurrency;
- distributed workers;
- manifest validation caching;
- sophisticated circuit breakers;
- a migrations framework beyond the needs of the chosen persistence implementation.

If a simple log/report/database table solves the current problem, use that.

---

## Repository Shape

Refactor toward:

```text
src/
├── addon/
│   ├── manifest/
│   ├── config/
│   ├── routes/
│   └── stremio-adapter/
├── engine/
│   ├── core/
│   ├── registry/
│   ├── resolver/
│   ├── transport/
│   ├── protocols/
│   └── health/
├── discovery/
│   └── fmhy/
│       ├── provider.ts
│       ├── parser.ts
│       ├── normalize.ts
│       ├── diff.ts
│       └── fixtures/
├── extractors/
│   ├── sources/
│   ├── hosts/
│   ├── generic/
│   └── registry.generated.ts
└── app/
    └── server/
```

Optional packages should appear only after a concrete need:

```text
observability/
admin/
cli/
persistence/
```

---

## Code Review Checklist

For every extraction-related PR, ask:

- Does this keep the Stremio end-to-end path working?
- Is the logic source-family-specific, host-specific, protocol-specific, or transport-specific, and is it placed accordingly?
- Did the extractor remain small?
- Is delegation returned as an `ExtractionResult` target rather than executed directly?
- Are new failures typed?
- Are matcher tests present?
- Are deterministic fixtures present?
- Does this introduce a new dependency edge worth recording?
- Does this add a global singleton/service locator that should instead be injected narrowly?
- Does it rely on FMHY for something FMHY does not actually provide, such as per-site title-search semantics?
- Does it preserve partial results under mixed failures/timeouts?
- Does it create optional infrastructure before a concrete problem requires it?

---

## Completion Characteristic

The project is in a good state when adding or repairing integrations usually means editing a small source-family or host module plus fixtures, rather than touching a central god class.

The intended maintenance loop is:

```text
FMHY changes candidate set
    -> candidate matches known source family or remains explicitly unsupported
    -> health check discovers typed failure
    -> dependency graph identifies root provider/family
    -> developer updates one focused adapter
    -> fixture/matcher tests prevent regression
    -> Stremio runtime resumes using healthy paths
```

That is the practical definition of a maintainable WebStreamrMBG successor.


## Implementation Tuning Rule

Do not delay the end-to-end implementation spine to tune confidence thresholds, probe budgets, top-K values, or corpus quorum numbers. Start with conservative configuration, instrument the outcomes, and adjust from observed behavior.

---


## Diagnostic sink enforcement note

Keep `FailureDiagnostic` out of normal logs. Its `sensitivity: "privileged"` marker documents the contract but does not enforce it; when a diagnostic store/logger sink is implemented, make that sink the only API that accepts privileged diagnostics.
