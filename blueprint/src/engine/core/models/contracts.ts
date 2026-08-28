import type { Failure } from "./failures";
import type { NormalizedStream, StreamCandidate } from "./streams";

// src/engine/core/models/contracts.ts
//
// Core carrier types finalized in TypeScript so the repository, not prose,
// is authoritative for their exact semantics.

/** Return type of the single capability extractors have: RequestServices.request(). */
export interface ExtractionResponse {
  status: number;
  /** Header names are normalized to lowercase by every transport backend. */
  headers: Readonly<Record<string, string>>;
  /** Post-redirect URL. Extractors resolve relative links against this, never the requested URL. */
  finalUrl: URL;
  /** Every hop, in order. Needed for REDIRECT_LOOP and for SSRF re-checks. */
  redirectChain: readonly URL[];
  /** Raw bytes. Decoding is explicit so charset bugs surface at the boundary. */
  body: Uint8Array;
  text(): string;
  json(): unknown;
  /** True when the transport truncated at a byte cap (probe budgets, ranged GETs). */
  truncated: boolean;
  timing: { startedAt: Date; elapsedMs: number };
}

export interface QueryOptions {
  deadlineMs?: number;
  preferredLanguages?: readonly string[];
  /** Bounded candidate set sent for fresh validation. Config, not architecture. */
  validationTopK?: number;
  maxSources?: number;
}

/**
 * Physically carries the partial-result invariant: success is "at least one
 * usable stream", independent of how much else failed or never finished.
 */
export interface StreamQueryResult {
  streams: readonly NormalizedStream[];
  failures: readonly Failure[];
  /** Selected but unvalidated when the deadline hit. Never silently merged into `streams`. */
  unverified: readonly StreamCandidate[];
  deadline: {
    budgetMs: number;
    elapsedMs: number;
    exceeded: boolean;
    sourcesAttempted: number;
    sourcesCompleted: number;
    sourcesCancelled: number;
  };
}

export function isSuccessful(result: StreamQueryResult): boolean {
  return result.streams.length > 0;
}
