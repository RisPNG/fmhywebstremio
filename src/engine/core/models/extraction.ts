import type { ExtractorFailure } from './failures';
import type { MediaIdentity } from './media';
import type { StreamCandidate } from './streams';
import type { RequestServices } from './transport';

export interface ExtractionTarget {
  url: URL;
  kind?: 'source-page' | 'embed' | 'manifest' | 'direct-media' | 'unknown';
  referrer?: URL;
  media?: MediaIdentity;
  hints?: Readonly<Record<string, unknown>>;
}
export interface MatchResult { matcherId: string; confidence: number; captures?: Readonly<Record<string, string>> }
export type ExtractionResult
  = | { type: 'streams'; streams: readonly StreamCandidate[] }
    | { type: 'redirect'; target: ExtractionTarget }
    | { type: 'embeds'; targets: readonly ExtractionTarget[] }
    | { type: 'empty'; reason: 'not-found' | 'no-streams' }
    | { type: 'failure'; failure: ExtractorFailure };
export interface Extractor {
  readonly id: string;
  match(target: ExtractionTarget): MatchResult | null;
  extract(target: ExtractionTarget, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}
