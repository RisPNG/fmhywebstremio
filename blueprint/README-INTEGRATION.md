# Using This Blueprint in the WebStreamrMBG Fork

Copy these files into the root of your fork:

```text
ARCHITECTURE.md
PLAN.md
README-INTEGRATION.md
```

Recommended repository starting point:

1. fork `newman2x/WebStreamrMBG`;
2. preserve license/attribution requirements;
3. rename the Stremio manifest identity for your fork;
4. deploy the fork unchanged once and confirm Stremio can install/use its endpoint;
5. commit these blueprint files;
6. work through `PLAN.md` in its listed dependency order while keeping the end-to-end Stremio path functional.

The blueprint deliberately does **not** divide work into named versions or phases. The implementation spine is always:

```text
Stremio request
    -> source family
    -> host extractor
    -> protocol validation
    -> Stremio response
```

Keep that path working and widen coverage around it.

## FMHY role

FMHY is the concrete directory source for candidate sites.

Documented references:

- `https://github.com/fmhy/FMHY/wiki/Backups`
- `https://github.com/fmhy/edit`
- `https://fmhy.net/video` for human inspection

Use FMHY to answer **which candidate sites exist**, not **how an arbitrary site searches for a particular movie or episode**. The latter belongs to a known `SourceFamily` implementation.

A new FMHY domain follows this logic:

```text
new FMHY candidate
    -> one bounded SourceProbeSnapshot
    -> evaluate all known SourceFamily.classify() functions locally
    -> central confidence + runner-up-margin arbitration
        -> known family: test discovery/extraction/stream validation
        -> ambiguous evidence: FAMILY_PROBE_AMBIGUOUS
        -> completed confident non-match: UNSUPPORTED_SOURCE_PATTERN
```

FMHY parsing must preserve a last-known-good snapshot. An upstream formatting change must not erase the local registry.

## Core ideas to protect during implementation

- tiny extractors, no giant base class;
- resolver owns recursion;
- extractors emit delegated targets rather than invoking each other;
- source families discover media on known frontend architectures;
- host extractors resolve embeds/providers;
- HLS/DASH/direct handling is protocol-level, not site-level;
- transport/retry/SSRF policy stays outside extractors;
- every failure is typed;
- dependency edges allow one broken provider to roll up multiple affected sources;
- user queries return partial valid results at deadline rather than failing because some sources were slow;
- `registry.generated.ts` is generated deterministically, committed, and checked by CI;
- optional dashboards/OTel/admin tooling do not block the core addon.

## Suggested first code review target

The first meaningful refactor should prove this without requiring FMHY ingestion or dashboards:

```text
existing Stremio route
    -> new MediaRequest boundary
    -> resolver
    -> one SourceFamily
    -> one HostExtractor
    -> HLS inspector
    -> validated stream
    -> existing Stremio response mapper
```

Once that works, add matcher indexing, transport isolation, FMHY ingestion, health classification, dependency edges, and broader coverage in the order described by `PLAN.md`.


## Current architectural emphasis

FMHY is a maintenance/discovery input, not the runtime data path. Each candidate is fetched/inspected once under a `ProbeBudget`, producing a shared `SourceProbeSnapshot`; all known source-family classifiers evaluate that same snapshot without additional family-specific fetches. Family health uses maintained positive and negative media cases with quorum semantics. Runtime stream selection uses deterministic cheap pre-ordering followed by bounded top-K fresh validation, with explicit validation state on returned candidates.

Exact thresholds for probe confidence, runner-up margin, corpus quorum, top-K, and budgets are empirical configuration. Do not delay the end-to-end implementation spine to tune them: start conservatively, instrument outcomes, and adjust from observed behavior.

## Core carrier contracts

The bundle includes `src/engine/core/models/contracts.ts` as executable repository guidance. It defines `ExtractionResponse`, `QueryOptions`, and `StreamQueryResult`, including the partial-result carrier semantics. Treat those TypeScript declarations—not duplicated prose—as the authoritative starting point for these contracts.

The bundle includes a pinned TypeScript dev dependency plus `npm run verify`. On a clean clone, run `npm install` and then `npm run verify`; it type-checks the model layer and runs diagnostic regression checks for URL value redaction, privileged body samples, charset-aware decoding, case-insensitive content-type capture, truncation safety, and explicit empty-body semantics.
