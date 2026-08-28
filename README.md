# FMHY's Website Streamer Addon for Stremio

Stremio Addon that serves video HTTP URLs from streaming websites listed by [FMHY](https://github.com/fmhy/FMHY/wiki/Streaming).

The addon keeps FMHY directory synchronization outside user requests. Maintenance jobs ingest the official video directory into a last-known-good local registry, classify candidates against bounded source-family fingerprints, run positive and negative health corpora, and record source-to-provider dependency edges. The runtime uses only sources with a successful validated extractability outcome and returns validated partial results within a hard deadline.

The extraction engine is organized around small tagged contracts:

```text
Stremio request
    -> source family
    -> resolver-owned host delegation
    -> HLS / DASH / direct-media inspection
    -> deterministic selection and deduplication
    -> Stremio response
```

Runtime sources come from the freshly audited FMHY registry. Every one-shot audit also generates the committed deployment registry, so the same passed sources are available on stateless hosts after the audit changes are committed. New integrations belong in focused source-family or host-extractor modules rather than route handlers. Sites absent from the current FMHY list or without fresh stream validation are not shipped.

## Development

Use the repository's mise-managed toolchain:

```sh
mise exec -- npm ci
mise exec -- npm run ci
mise exec -- npm run build
```

`npm run verify:contracts`, `npm run verify:diagnostics`, and `npm run verify:registry` provide focused architectural regression checks. The generated matcher registry is committed and verified in CI.

## Live extractability report

Run the opt-in live audit separately from deterministic CI tests:

```sh
mise exec -- npm run test:extractability
```

The audit fetches the FMHY video directory, reports every normalized entry, recognizes supported site families, and tests known positive and negative media cases through discovery, extraction, and fresh stream validation. Its JSON report is saved to `.data/extractability/report.json`, while runtime eligibility and health history are saved to `.data/extractability/sources.json`. Passed sources are also written to `src/engine/registry/deployment-registry.generated.ts` for stateless deployment.

Provider dependency edges are saved to `.data/extractability/dependencies.json`. The report includes root-cause groups that connect a typed provider or protocol failure to every affected source.

An individual site failure is a report result rather than a test-process failure. The command exits successfully when at least one site produces a freshly validated stream and exits unsuccessfully when no site does. `extractable` and `degraded` report entries are runtime-eligible only when they contain at least one validated positive result. Recognition-only, discovery-only, failed, redirected, unreachable, blocked, inconclusive, unknown, unsupported, disabled, and untested entries are not exposed by the runtime.

The report keeps site disposition separate from extractability. `redirected` records include the observed final URL when a candidate resolves to an unrelated domain. `unreachable` records include timeout, DNS, connection, TLS, or equivalent probe failures. `blocked` distinguishes access denial or rate limiting from a site that appears down. `inconclusive` covers ambiguous recognition or an exhausted probe budget, while `unsupported` means the site responded successfully but did not match an implemented source family. Tested family cases retain their discovery, extraction, validation, and typed failure details.

The server loads a persisted eligibility registry when one exists and otherwise uses the committed deployment registry. It checks for atomic registry updates every minute by default, so a maintenance process with shared persistent storage can activate a completed audit without a restart. Set `EXTRACTABILITY_RELOAD_INTERVAL_MS=0` to disable live reload or choose another positive interval. Every shipped passed FMHY site is added to the configure page with its current health outcome. The enabled or disabled value is encoded into that configured add-on URL and filters runtime source selection. The audit currently recognizes only source families implemented by this repository, so broad directory reporting does not imply broad extraction support.

The implemented reusable families are Cinrift frontends backed by the Vidrift grant and source APIs, P-Stream-compatible frontends backed by the shared provider architecture, and Dooplay sites backed by their shared discovery routes. P-Stream sites remain non-eligible when the provider architecture cannot find the known health-corpus media from the deployment network. Dooplay sites remain non-eligible when search discovery is incomplete or delegated players fail fresh validation. Browser-only anti-bot challenges, authenticated sites, client applications without a server-reproducible playback contract, and hosts that return expired media remain typed blocked, unsupported, failed, or inconclusive results rather than passes.

Run continuous maintenance with:

```sh
mise exec -- npm run maintain:extractability
```

Watch mode runs immediately and then every six hours. `EXTRACTABILITY_INTERVAL_MS` controls the maintenance interval, while `EXTRACTABILITY_REPROBE_INTERVAL_MS` controls how soon a previously classified candidate is eligible for a fresh family probe. The default candidate reprobe interval is 24 hours. A one-shot audit retains the requested aggregate exit rule; watch mode remains alive and reports each run even when a run has zero extractable sites.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the deployment and Stremio installation checks. The detailed implementation contract remains in [`blueprint/ARCHITECTURE.md`](blueprint/ARCHITECTURE.md) and [`blueprint/PLAN.md`](blueprint/PLAN.md).
