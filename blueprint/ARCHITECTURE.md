# WebStreamrMBG Fork Architecture

## 1. Goal and Starting Point

This repository is a **fork of `newman2x/WebStreamrMBG` whose primary product remains an installable Stremio addon**.

The fork preserves the working Stremio shell: manifest/configuration behavior, addon routes, server startup/deployment model, stream-response mapping, and any existing metadata integration that remains useful. The extraction internals are progressively replaced inside the same repository. Do not build a disconnected framework first and integrate Stremio later.

The runtime and maintenance paths are intentionally separate.

```text
RUNTIME DATA PATH

Stremio media request
        |
        v
supported healthy source families
        |
        v
resolver-owned extraction graph
        |
        v
source family -> host extractor -> stream candidate
        |
        v
cheap deterministic candidate ordering
        |
        v
bounded top-K fresh validation
        |
        v
deduplicate + final deterministic ordering
        |
        v
Stremio stream response

MAINTENANCE / DISCOVERY INPUT

FMHY maintained directory
        |
        v
FmhyDirectoryProvider
        |
        v
candidate source registry
        |
        +----> domain/alias tracking
        +----> networked source-family probing
        +----> health/support state
        `----> maintenance queue for unknown architectures
```

The system is intended for sites, APIs, and streams the operator is authorized to automate and expose. Technical accessibility is not treated as permission.

### The central maintenance insight

The architecture exists because many visible frontend sites tend to collapse into a much smaller dependency graph:

```text
many frontends
    -> fewer source families
        -> fewer aggregators/embed providers
            -> fewer host extractors
                -> HLS / DASH / direct media
```

The maintenance win is not merely "more scrapers." It is that one broken provider can be identified as the root cause of many failing frontends.

Example:

```text
provider-x extractor fails
        |
        +-- source-a affected
        +-- source-b affected
        +-- source-c affected
        +-- source-d affected
```

The engine should be able to report:

```text
HOST_EXTRACTION_FAILED
provider: provider-x.example
affected sources: 4
```

That typed failure plus dependency rollup is a load-bearing feature, not an optional dashboard idea.

---

## 2. Load-Bearing Architecture

Only a small set of concepts are mandatory to make the system maintainable:

1. a tiny `Extractor` contract;
2. a tagged `ExtractionResult` union;
3. resolver-owned recursion with cycle/depth guards;
4. a matcher registry with specificity/priority and declarative tests;
5. a transport director that keeps network policy out of extractors;
6. explicit source-family versus host-extractor roles;
7. FMHY ingestion into a local candidate registry;
8. typed failures and extraction dependency edges;
9. protocol-level validation for HLS/DASH/direct media;
10. partial-result semantics and deterministic ordering.

Everything else—dashboards, OpenTelemetry, admin APIs, advanced caching, adaptive concurrency, distributed workers—is optional operational tooling and must not be a prerequisite for a working addon.

### Architectural invariants

**Extractor invariant**

> An extractor may discover or transform targets, but it does not own transport policy, global state, protocol machinery, ranking, persistence, or Stremio-facing behavior.

**Resolver invariant**

> Extractors emit delegated targets; the resolver owns execution of those targets. An extractor does not directly invoke another extractor.

**Failure invariant**

> Every unsuccessful extraction terminates in a typed, actionable failure state.

**Registry invariant**

> FMHY supplies candidate sources. The addon itself decides whether each candidate is supported and healthy.

**Runtime invariant**

> User queries consume maintained registry state; they do not rebuild the source directory from FMHY on every request.

**Partial-result invariant**

> A query returns the best valid streams available when its deadline is reached. Failed or slow sources do not invalidate successful results from other sources.

---

## 3. Core Contracts

### Media identity

Stremio request parsing must be separated from extraction logic.

```ts
interface MediaRequest {
  type: "movie" | "episode";
  imdbId?: string;
  tmdbId?: number;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  preferredLanguages?: string[];
}

interface MediaIdentity {
  canonicalId: string;
  type: "movie" | "episode";
  imdbId?: string;
  tmdbId?: number;
  title: string;
  year?: number;
  season?: number;
  episode?: number;
}
```

The Stremio adapter converts addon requests to `MediaRequest`; a media resolver produces `MediaIdentity`; extractors receive the canonical identity instead of Stremio-specific route objects.

### SourceRecord

`SourceRecord` is the local registry representation of a candidate or supported source. FMHY metadata is preserved as provenance, but family membership is discovered independently and may change over time.

The canonical type lives in `src/engine/core/models/source.ts`; do not duplicate it in planning documents. It carries domain identity and aliases, FMHY provenance, optional family confidence/evidence, probe timestamp, and the local `unknown | supported | degraded | unsupported | disabled` status.

### ExtractionTarget

Every URL-like unit that the resolver may process is represented as a target.

```ts
interface ExtractionTarget {
  url: URL;
  kind?: "source-page" | "embed" | "manifest" | "direct-media" | "unknown";
  referrer?: URL;
  media?: MediaIdentity;
  hints?: Record<string, unknown>;
}
```

Do not pass naked URL strings through the engine when referrer/media context matters.

### Extractor

Keep the contract deliberately small.

```ts
interface Extractor {
  readonly id: string;
  match(target: ExtractionTarget): MatchResult | null;
  extract(
    target: ExtractionTarget,
    services: RequestServices,
    signal: AbortSignal,
  ): Promise<ExtractionResult>;
}

interface MatchResult {
  matcherId: string;
  confidence: number;
  captures?: Record<string, string>;
}
```

Avoid inheritance-heavy base classes. The implementation should not drift toward a giant `InfoExtractor`-style convenience surface.

### RequestServices

Do not inject a universal service locator. Extractors get one narrow request capability:

```ts
interface RequestServices {
  request(request: ExtractionRequest, signal: AbortSignal): Promise<ExtractionResponse>;
}
```

If an extractor later needs another capability, add a narrow capability-specific contract rather than exposing database, ranking, metrics, credentials, resolver, browser, and caches to every extractor by default. Probe cost is enforced by the probe runner's explicit budget, not by inventing a structurally identical service type.

The resolver itself remains responsible for recursion.

### ExtractionResult

Use a tagged union rather than loosely structured result dictionaries.

```ts
type ExtractionResult =
  | StreamsResult
  | RedirectResult
  | EmbedsResult
  | EmptyResult
  | FailureResult;

interface StreamsResult {
  type: "streams";
  streams: StreamCandidate[];
}

interface RedirectResult {
  type: "redirect";
  target: ExtractionTarget;
}

interface EmbedsResult {
  type: "embeds";
  targets: ExtractionTarget[];
}

interface EmptyResult {
  type: "empty";
  reason: "not-found" | "no-streams";
}

interface FailureResult {
  type: "failure";
  failure: ExtractorFailure;
}
```

`empty` means the extractor ran correctly and found nothing usable. Unsupported architectures, parser breakage, network/transport failures, and other unsuccessful operations use typed `FailureResult` values instead. Unexpected extractor bugs throw and are converted by the resolver/runtime boundary into `EXTRACTOR_EXCEPTION` or `INTERNAL_ERROR`; extractors do not construct those codes defensively.

This preserves yt-dlp's useful delegation idea while making execution ownership explicit: extractors describe the next target; the resolver decides how it is executed.

---

## 4. Resolver and Matcher Registry

### Resolver-owned recursion

The resolver is the single owner of recursive extraction.

```text
resolve(target)
    -> registry.match(target)
    -> extractor.extract(target)
    -> result
        -> streams: collect
        -> redirect: resolve delegated target
        -> embeds: resolve child targets concurrently
        -> empty: record outcome
```

An extractor must not import or call another extractor implementation directly.

### Cycle guard

The resolver maintains a visited set based on a normalized target fingerprint.

```ts
if (visited.has(fingerprint(target))) {
  throw failure("EXTRACTION_CYCLE");
}
```

### Depth guard

Recursion must have a configurable finite maximum depth. Do not encode an arbitrary architectural truth such as "8 hops are normal." Real chains should be measured; a conservative default around 4-5 is reasonable, with explicit configuration if evidence demands more.

### Partial results

A query is successful if at least one usable stream has been produced before the request deadline.

```text
12 sources attempted
3 produced valid streams
4 failed
2 still running
deadline reached
    -> cancel outstanding work
    -> rank/dedupe the 3 valid results
    -> return them
```

The entire request fails only when zero usable streams exist.

### Matcher specificity

All candidate matchers are evaluated and the most specific/high-confidence match wins. Generic fallback extractors must never shadow site/host-specific extractors.

### Declarative metadata

Do not load every extractor module simply to determine which one owns a URL. Use constrained metadata that can be indexed at build time.

Example:

```ts
export const metadata = {
  id: "provider-x",
  kind: "host",
  matchers: [
    {
      id: "embed",
      hostname: "embed.provider-x.example",
      path: "^/e/",
      priority: 100,
    },
  ],
};
```

Generate `registry.generated.ts` from this constrained metadata. **Commit the generated registry to the repository.** CI regenerates it and requires a clean diff, so stale registry state becomes visible in pull requests.

### Matcher tests

Every matcher must have:

- at least one positive URL;
- at least one negative URL;
- expected captures where applicable.

The central harness must also run a shared cross-extractor corpus so a new generic matcher cannot accidentally claim another extractor's URLs.

---

## 5. Source Families and Host Extractors

The WebStreamr `Source`/`Extractor` split is retained but clarified.

### Source family

A source family knows how to locate a requested media item on one known frontend architecture or clone family.

Family recognition is a **networked probe**, not a pure domain/tag matcher. Two domains using the same frontend may share no useful registry metadata, so recognition must inspect bounded evidence from the live site.

```ts
interface SourceFamily {
  readonly id: string;

  classify(
    source: SourceRecord,
    snapshot: SourceProbeSnapshot,
  ): FamilyMatch | null;

  discoverMedia(
    media: MediaIdentity,
    source: SourceRecord,
    services: RequestServices,
    signal: AbortSignal,
  ): Promise<ExtractionResult>;
}

interface FamilyMatch {
  familyId: string;
  confidence: number;
  evidence: FamilyEvidence[];
}

interface ProbeBudget {
  maxRequests: number;
  maxBytes: number;
  deadlineMs: number;
}

interface SourceProbeSnapshot {
  finalUrl: URL;
  status: number;
  headers: Record<string, string>;
  htmlSample?: string;
  domFingerprint?: string;
  assetPaths: string[];
  scriptSignatures: string[];
  routeHints: string[];
}

type FamilyEvidence =
  | { type: "asset-path"; value: string }
  | { type: "dom-shape"; fingerprint: string }
  | { type: "route-shape"; value: string }
  | { type: "generator-meta"; value: string }
  | { type: "api-shape"; fingerprint: string }
  | { type: "script-signature"; fingerprint: string };
```

Family recognition is orchestrated centrally. The probe runner performs one bounded fetch/inspection per candidate source, builds a shared `SourceProbeSnapshot`, and evaluates every known family as a pure classifier over that same evidence. The runner owns the `ProbeBudget`, so recognition cannot expand into an unbounded crawl.

Winner selection is also centralized: require both a minimum confidence and a sufficient margin over the runner-up. Exact thresholds are empirical configuration, and per-family overrides are allowed when observed fingerprint stability shows that global defaults are too noisy. If evidence is too close, emit `FAMILY_PROBE_AMBIGUOUS`; if probing completes successfully and no family clears the threshold, emit `UNSUPPORTED_SOURCE_PATTERN`.

The key correction is that **FMHY listing a new domain does not imply the engine knows how to search that site for a title**.

Automatic onboarding is only realistic when bounded probing identifies a known source family with sufficient confidence.

```text
FMHY adds site-d.example
        |
        v
one bounded probe snapshot
        |
        +-- known FooFrontend classifier wins by confidence + margin
        |       -> assign family + confidence/evidence
        |       -> run family health corpus
        |       -> potentially support automatically
        |
        `-- no known family
                -> UNSUPPORTED_SOURCE_PATTERN
```

This is the realistic meaning of self-updating source coverage.

### Host extractor

A host extractor resolves an embed/player/provider target into another target or into stream candidates.

```text
source family
    -> embed target
        -> host extractor
            -> .m3u8 / .mpd / direct media
```

A source family must not embed downstream host-specific logic when the host can be represented independently.

### Generic fallback

A conservative generic detector may identify obvious structures:

- `<iframe>` embeds;
- `<video>/<source>` elements;
- explicit HLS/DASH URLs;
- known player JSON shapes;
- known host links.

It must not be described as a universal mechanism that learns arbitrary search semantics for unseen sites. Unknown source architecture remains an actionable unsupported case.

### Extraction dependency graph

Whenever extraction delegates from one layer to another, persist or record an edge:

```ts
interface ExtractionEdge {
  fromNode: string;
  toNode: string;
  fromHost?: string;
  toHost?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  successCount: number;
  failureCount: number;
}
```

This makes root-cause grouping possible without requiring a visual dashboard.

---

## 6. Transport and Request Policy

Extractors do not directly choose HTTP libraries or retry policy.

### ExtractionRequest

```ts
interface ExtractionRequest {
  url: URL;
  method?: "GET" | "POST" | "HEAD";
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
  referrer?: URL;
  expectedContent?: "html" | "json" | "text" | "binary" | "manifest";
  capabilities?: TransportCapability[];
  stateScope?: {
    kind: "query" | "source" | "host";
    key: string;
  };
}

type TransportCapability =
  | "http"
  | "cookies"
  | "redirects"
  | "streaming-response"
  | "browser-rendering";
```

### TransportDirector

The director chooses a supporting backend and owns retries/fallback policy.

```text
ExtractionRequest
    -> validate SSRF policy
    -> select supporting backend
    -> execute
    -> typed transport result/failure
```

Start with ordinary HTTP as the normal path. Browser rendering is an optional capability, not a default dependency of every extractor.

### Cookie and request-state ownership

Cookie/state ownership must be explicit even before a full session-pool subsystem exists. `stateScope` identifies the jar/state namespace used by the transport layer.

Examples:

```text
query:<request-id>
source:<source-id>
host:<canonical-host>
```

The initial implementation may use one jar per host/source scope. Do not use an implicit process-global cookie jar. A `query`-scoped jar isolates separate user queries, but it does not guarantee identical behavior across queries because cookie warm-up and intra-query request order can change upstream responses. Use `source` or `host` scope only when persistence is required and justified.

### Bounded concurrency

Do not begin with adaptive CPU/memory pressure machinery. This workload is bounded by a finite source set and a hard per-query deadline.

Use:

- one configurable global semaphore;
- one configurable per-host/per-provider semaphore;
- a separate browser semaphore if browser transport exists;
- `AbortSignal` propagated through every request.

If production evidence later shows oscillation or resource pressure that simple semaphores cannot control, adaptive load control can be introduced separately with time-windowed hysteresis rather than instantaneous scalar samples.

### Retry policy

Retries belong to transport policy, not extractor code.

Examples:

```text
connection reset      -> retry may be reasonable
HTTP 404              -> do not retry blindly
schema mismatch       -> do not retry
rate limited          -> back off / mark source degraded
request deadline hit  -> cancel
```

### SSRF protection

A resolver that follows external targets is an SSRF engine unless constrained.

Before connecting, block private/link-local/loopback/metadata ranges. Re-check after DNS resolution and after every redirect. Do not trust the original hostname alone.

At minimum block equivalent IPv4/IPv6 ranges for:

- loopback;
- RFC1918 private networks;
- link-local;
- cloud metadata endpoints;
- other explicitly configured internal ranges.

Redirect count must be finite.

---

## 7. FMHY Ingestion

FMHY is the concrete candidate directory for this project. The code may retain a narrow interface boundary, but `FmhyDirectoryProvider` is the actual configured implementation.

### References

Document these locations in the repository:

- `https://github.com/fmhy/FMHY/wiki/Backups`
- `https://github.com/fmhy/edit`
- `https://fmhy.net/video` for human inspection

Prefer an official raw/machine-consumable representation exposed through FMHY's source/backups material rather than scraping the rendered website. Do not assume that representation has a stability contract.

### The provider is a parser, not an API contract

Treat FMHY input as externally controlled structured content that can change formatting.

```ts
interface DirectoryProvider {
  fetchSnapshot(signal: AbortSignal): Promise<DirectorySnapshot>;
}

class FmhyDirectoryProvider implements DirectoryProvider {
  // fetch + parse + validate + normalize
}
```

The generic interface exists only to isolate FMHY-specific parsing from the extraction engine. The plan is not provider-neutral.

### Snapshot model

```ts
interface DirectorySnapshot {
  fetchedAt: Date;
  upstreamVersion?: string;
  entries: FmhyDirectoryEntry[];
}

interface FmhyDirectoryEntry {
  name: string;
  urls: URL[];
  section: string;
  tags: string[];
  mirrors: URL[];
  apiHint: boolean;
}
```

### Parser validation

FMHY parser fixtures are mandatory. At least:

- known-good current fixture;
- multiple entries;
- mirrors/aliases;
- malformed link;
- section not relevant to the addon;
- formatting change fixture when one is encountered in production.

### Directory-specific failures

Directory ingestion needs its own typed failure branch:

```text
DIRECTORY_FETCH_FAILED
DIRECTORY_FORMAT_CHANGED
DIRECTORY_ENTRY_INVALID
DIRECTORY_CATEGORY_MISSING
DIRECTORY_PARSE_PARTIAL
```

### Last-known-good behavior

Never replace a valid local registry with an empty or partial registry because FMHY parsing changed.

```text
new FMHY fetch
    -> parse/validate
        -> success: diff and apply
        -> failure: keep last-known-good snapshot
                    record DIRECTORY_* failure
```

### Diff semantics

A successful snapshot produces explicit events:

```text
SOURCE_ADDED
SOURCE_REMOVED
DOMAIN_ADDED
DOMAIN_REMOVED
METADATA_CHANGED
UNCHANGED
```

A new candidate begins as `UNKNOWN`, not `SUPPORTED`.

### FMHY is discovery, not search logic

FMHY typically identifies a source/domain/category. It does not provide the per-site algorithm required to find a specific movie or episode. That algorithm belongs to a matching source family.

Therefore:

```text
FMHY candidate
    -> known source family? yes -> run support/health checks
                           no  -> UNSUPPORTED_SOURCE_PATTERN
```

That limitation must remain explicit throughout implementation and documentation.

---

## 8. Health, Typed Failures, and Maintenance

### Positive and negative health probe corpus

A source-family health check must not use an arbitrary title. Each supported family maintains a small probe corpus of media known to be discoverable through that family. Otherwise `MEDIA_NOT_FOUND` is ambiguous between normal catalog absence and a broken discovery path.

```ts
type ProbeExpectation = "discoverable" | "absent";

interface FamilyProbeCase {
  id: string;
  media: MediaIdentity;
  expected: ProbeExpectation;
  notes?: string;
}

interface FamilyHealthCorpus {
  familyId: string;
  cases: FamilyProbeCase[];
}
```

Prefer multiple stable positive cases where practical: at least a movie and an episode for families that support both. Negative (`absent`) cases are also valuable because they catch search paths that begin returning plausible-looking matches for everything. Record why each case has its expectation. A failure on a known-positive case should use `KNOWN_PROBE_MEDIA_NOT_FOUND` or a more specific parser/transport failure rather than generic `MEDIA_NOT_FOUND`.

Aggregate corpus health with quorum semantics rather than one-case absolutes: a configured majority/quorum of positive cases failing indicates likely degradation; one repeatedly failing positive while the others pass flags that probe case as possibly stale and queues it for review; an `absent` case unexpectedly becoming discoverable is an anomaly but does not by itself prove the source is unavailable. The exact quorum is empirical configuration.

### Three distinct checks

Do not collapse health into one boolean.

**Discovery**

Can the source family locate the requested title/episode?

**Extraction**

Can the discovered result reach a known embed/host or stream candidate?

**Stream validation**

Is the final candidate structurally usable now?

A source can therefore be degraded rather than simply red.

### Failure taxonomy

Use a real enum/tagged hierarchy rather than arbitrary strings.

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

The code owns two related but different concepts:

- `categoryOf(code)` returns a prefixed taxonomy value such as `category:network`;
- `Failure.stage` is a separately prefixed runtime position such as `stage:transport`, stamped by the resolver/runtime when known.

The prefixes intentionally make category and stage non-cross-assignable in TypeScript.

Retry behavior has an exhaustive default mapping `defaultRetryPolicyOf(code): "none" | "immediate" | "backoff" | "re-extract" | "defer"`, not a boolean. The default for `TIMEOUT` is `defer`, because immediately repeating a timed-out operation can consume the same query budget twice. The caller may override the default by execution context; a scheduled health probe and a user query do not have to make the same retry choice. Adding a `FailureCode` fails compilation until its default policy is defined.

`EXTRACTOR_EXCEPTION` and `INTERNAL_ERROR` are runtime-boundary codes and are excluded from `ExtractorFailureCode`, so extractor-owned `FailureResult` values cannot compile with them. Unexpected throws are caught and converted by the resolver/runtime.

### Boundary validation

Validate JSON/structured responses immediately when consumed. A changed response shape should produce `RESPONSE_SCHEMA_CHANGED`, not an unrelated `TypeError` several frames later.

Use a small schema library if helpful; do not recreate Streamlink's entire validation DSL without need.

### Diagnostics

Capture bounded evidence sufficient to debug a failure with a fixed `FailureDiagnostic` shape: status, content type, sanitized final URL and redirect chain, explicit body-capture state, bounded body sample plus truncation flag, and parser/schema path. Use the centralized `captureDiagnostic(source, { maxBytes, parserPath? })` helper so URL userinfo and fragments are removed by default and query parameter names are preserved with empty values, while body-size limits are enforced once, zero-length captured bodies remain distinguishable from uncaptured bodies, and samples honor a declared response charset with UTF-8 fallback without inventing a replacement character at a truncation boundary. `FailureDiagnostic` is privileged data because `bodySample` can still contain signed URLs, tokens, or inline credentials; it must not be emitted to normal logs. Full URLs require an explicit debugging opt-in. Transport backends must normalize response header names to lowercase; diagnostic capture also performs a defensive case-insensitive lookup.

### Root-cause rollup

The engine should be able to group failures by dependency node:

```text
UNKNOWN_HOST: provider-new.example
  affected sources: 7

SEARCH_FAILED: source-family-foo
  affected sources: 3
```

A textual CLI/report is enough initially. A visual graph dashboard is optional tooling.

---

## 9. Stream Normalization, Validation, Deduplication, Ordering

### StreamCandidate

Extractors discover candidates; they do not claim unverified properties.

```ts
interface StreamCandidate {
  url: URL;
  protocol: "hls" | "dash" | "http" | "unknown";
  headers?: Record<string, string>;
  referrer?: URL;
  language?: string;
  label?: string;
  sourceExtractor: string;
  discoveredAt: Date;
}

type StreamValidationState = "validated" | "unverified" | "failed";

interface NormalizedStream {
  url: URL;
  protocol: "hls" | "dash" | "http";
  validation: StreamValidationState;
  resolution?: { width: number; height: number };
  bitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
  language?: string;
  headers?: Record<string, string>;
  sourceId: string;
  sourceExtractor: string;
}
```

### Protocol inspection

Keep protocol handling site-independent.

```text
StreamCandidate(.m3u8)
    -> HlsInspector
        -> parsed variants
        -> structural validation
        -> NormalizedStream
```

Equivalent `DashInspector` and direct-media inspection can exist behind the same boundary.

### Fresh validation and bounded top-K policy

A previous successful validation is not proof that a signed/expiring stream still works. Avoid caching "stream is valid" as a long-lived truth.

Fresh validation itself costs network round trips, so do not attempt to validate every candidate under a hard deadline. Use a two-step policy:

```text
all extracted candidates
    -> cheap deterministic pre-order
    -> select bounded top K
    -> validate those candidates in parallel
    -> return validation state with each surviving stream
```

The cheap pre-order may use source health/history, protocol preference, declared/parsed quality metadata already available, language preference, and deterministic source/extractor tie-breaks. It must not depend on promise completion order.

`K` is configurable and should be chosen from measurements. `NormalizedStream.validation` carries the explicit state.

If the deadline arrives before every selected candidate validates, return usable partial results with their current validation state according to policy; do not silently pretend unverified means validated.

If manifest parse caching is later introduced, distinguish parsed structure from current reachability. The latter must be fresh enough for the current query.

### Deduplication

Do not define stream identity primarily by normalized hostname. The same underlying stream may be served through different CDN hostnames.

Use layered evidence:

1. exact/canonical candidate URL where appropriate;
2. known provider/content identifiers;
3. parsed manifest structural fingerprint such as variant ladder, codecs, duration characteristics, and segment path patterns.

A structural match should be treated as a **probable duplicate**, not cryptographic identity.

### Deterministic ordering

Do not begin with invented 100-point weights.

Use two deterministic orderings:

**Pre-validation ordering** chooses the bounded top-K using only cheap information that is already known without extra validation requests:

1. healthy/reliable source before degraded/repeatedly failing source;
2. preferred language before other languages;
3. preferred protocol/quality metadata before less preferred alternatives;
4. lower recent extraction latency as a tie-breaker;
5. deterministic source/extractor/URL tie-break.

**Post-validation ordering** may then prefer `validated` over `unverified` among the bounded candidates while retaining the same deterministic tie-breaks. `failed` candidates are excluded.

If enough runtime history exists later, these rules may be converted to a configurable scoring function. Promise completion order must never determine which candidates were selected for validation or the final ordering.

---

## 10. Stremio Adapter and Runtime Request Flow

The Stremio integration remains thin.

```text
Stremio route
    -> parse MediaRequest
    -> MediaResolver
    -> StreamEngine.findStreams()
    -> map NormalizedStream[] to Stremio response
```

Do not place source or host extraction logic inside HTTP route handlers.

A clean engine API is sufficient:

```ts
interface StreamEngine {
  findStreams(
    request: MediaRequest,
    options?: QueryOptions,
  ): Promise<StreamQueryResult>;
}
```

### Query strategy

Do not hit every supported source immediately.

Use a bounded set of currently healthy sources, then widen only if too few usable streams are found.

```text
start best-known sources
    -> enough valid results? return
    -> otherwise widen candidate set
    -> deadline reached? return partial valid results
```

The exact widening policy should remain simple until measurements justify sophistication.

### Query deadline

A hard per-request deadline protects the addon from slow/broken sources. Propagate cancellation via `AbortSignal` through source discovery, host extraction, and validation.

### No directory fetch on query path

FMHY synchronization is outside the user request path. User queries read the local registry and current health state.

---

## 11. Repository Structure and Dependency Direction

A practical target layout inside the WebStreamrMBG fork:

```text
src/
├── addon/
│   ├── manifest/
│   ├── config/
│   ├── routes/
│   └── stremio-adapter/
│
├── engine/
│   ├── core/
│   ├── resolver/
│   ├── registry/
│   ├── transport/
│   ├── protocols/
│   └── health/
│
├── discovery/
│   └── fmhy/
│       ├── provider.ts
│       ├── parser.ts
│       ├── normalize.ts
│       ├── diff.ts
│       └── fixtures/
│
├── extractors/
│   ├── sources/
│   ├── hosts/
│   ├── generic/
│   └── registry.generated.ts
│
└── app/
    └── server/
```

Optional operational packages should only appear if justified by use:

```text
observability/
admin/
cli/
persistence/
```

Dependency direction should remain one-way:

- extractors may depend on core contracts and narrow request capabilities;
- extractors may not depend on Stremio routes, database implementations, dashboards, or application bootstrap;
- FMHY parsing may not leak into extractor logic;
- transport may not depend on media ranking or Stremio types.

Use import-boundary linting if needed to enforce this.

---

## 12. Definition of a Healthy Architecture

The architecture is succeeding when:

- the fork remains directly deployable/installable as a Stremio addon;
- one extractor can be reasoned about without reading unrelated extractors;
- a new FMHY domain is probed against known source families using bounded evidence and confidence, or becomes explicitly unsupported;
- a host/provider break produces one typed root cause with upstream impact rather than many unrelated failures;
- an extractor can delegate by returning a target without invoking another extractor directly;
- protocol inspection is reused across all sites;
- slow/failing sources do not erase valid partial results;
- family health checks use maintained positive/negative probe media so catalog absence is not confused with breakage;
- cookie/request state has an explicit query/source/host scope rather than hidden global ownership;
- bounded top-K selection is deterministic before fresh validation begins;
- a changed FMHY format preserves the last-known-good local registry;
- adding a new extractor does not require editing a giant central base class;
- production request ordering is deterministic and independent of promise completion order.

The target is not a giant generic scraper framework. It is **a small extraction runtime supporting many tiny source-family and host adapters behind a stable Stremio shell**.

---


## Implementation Tuning Rule

Do not delay the end-to-end implementation spine to tune confidence thresholds, probe budgets, top-K values, or corpus quorum numbers. Start with conservative configuration, instrument the outcomes, and adjust from observed behavior.


## Appendix A. Open-Source Reference Synthesis

### Streamlink

Take:

- lazy plugin/extractor indexing;
- matcher priority/specificity;
- declarative matcher tests;
- protocol separation;
- validation close to response boundaries.

Do not copy:

- thread-oriented streaming internals unless proxying media becomes necessary;
- a large custom validation DSL without evidence it is needed.

### yt-dlp

Take:

- delegation as structured results;
- transport director / handler routing;
- per-request capability validation;
- generic fallback concepts.

Modify the delegation model so the **resolver**, not extractor implementations, owns execution of delegated targets.

Do not copy:

- giant base classes;
- universal helper objects;
- cross-cutting inherited convenience methods.

### Crawlee

Take selectively:

- the conceptual idea of session-bound identity if a source genuinely needs reusable cookies/state;
- per-source/per-host concurrency discipline.

Do not make adaptive concurrency/load-signal infrastructure part of the core unless measurements demonstrate a need.

### Katana

Take selectively:

- URL-shape normalization;
- crawler-trap reduction;
- near-duplicate concepts for discovery.

Do not treat Katana as a stream-extraction framework.

### WebStreamr/WebStreamrMBG

Retain:

- the deployable Stremio shell;
- the source-versus-host conceptual split;
- useful configuration/deployment behavior.

Replace:

- hidden globals/singletons;
- hard-wired fetch behavior;
- source-specific transport hacks;
- Stremio concerns leaking into extraction internals.

---

## Appendix B. Optional Operational Tooling

These are useful but **not prerequisites** for the core architecture:

- OpenTelemetry tracing;
- rich metrics;
- admin HTTP surface;
- visual health dashboard;
- dependency graph visualization;
- advanced CLI;
- manifest parse caching;
- circuit breakers;
- adaptive concurrency;
- distributed workers;
- migrations framework beyond what the chosen persistence mechanism actually needs.

Add them only when a concrete maintenance or operational problem justifies them.

A simple text report such as:

```text
provider-x: HOST_EXTRACTION_FAILED
  source-a
  source-b
  source-c
```

is already enough to realize the primary dependency-graph maintenance benefit.

---


### Diagnostic sink boundary

`FailureDiagnostic` is privileged evidence, not a normal-log payload. The `sensitivity: "privileged"` marker is metadata only until a privileged diagnostic sink exists; normal logging code must not serialize `bodySample` or other privileged fields. Enforcement belongs at that sink/API boundary when it is implemented.
