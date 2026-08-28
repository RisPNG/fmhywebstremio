import type { ExtractorFailure } from "./failures";
import type { MediaIdentity } from "./media";
import type { StreamCandidate } from "./streams";
import type { RequestServices } from "./transport";

export interface ExtractionTarget {
  url: URL;
  kind?: "source-page" | "embed" | "manifest" | "direct-media" | "unknown";
  referrer?: URL;
  media?: MediaIdentity;
  hints?: Readonly<Record<string, unknown>>;
}

export interface MatchResult {
  matcherId: string;
  confidence: number;
  captures?: Readonly<Record<string, string>>;
}

export interface StreamsResult {
  type: "streams";
  streams: readonly StreamCandidate[];
}

export interface RedirectResult {
  type: "redirect";
  target: ExtractionTarget;
}

export interface EmbedsResult {
  type: "embeds";
  targets: readonly ExtractionTarget[];
}

export interface EmptyResult {
  type: "empty";
  reason: "not-found" | "no-streams";
}

/** Expected extraction failure; unexpected engine bugs should still throw. */
export interface FailureResult {
  type: "failure";
  failure: ExtractorFailure;
}

export type ExtractionResult =
  | StreamsResult
  | RedirectResult
  | EmbedsResult
  | EmptyResult
  | FailureResult;

export interface Extractor {
  readonly id: string;
  match(target: ExtractionTarget): MatchResult | null;
  extract(
    target: ExtractionTarget,
    services: RequestServices,
    signal: AbortSignal,
  ): Promise<ExtractionResult>;
}
