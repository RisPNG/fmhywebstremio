import type { Failure } from './failures';
import type { MediaRequest } from './media';
import type { NormalizedStream, StreamCandidate } from './streams';

export interface ExtractionResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  finalUrl: URL;
  redirectChain: readonly URL[];
  body: Uint8Array;
  text(): string;
  json(): unknown;
  truncated: boolean;
  timing: { startedAt: Date; elapsedMs: number };
}
export interface QueryOptions { deadlineMs?: number; preferredLanguages?: readonly string[]; validationTopK?: number; maxSources?: number; initialSourceBatch?: number; minimumCandidates?: number }
export interface StreamQueryResult {
  streams: readonly NormalizedStream[];
  failures: readonly Failure[];
  unverified: readonly StreamCandidate[];
  deadline: { budgetMs: number; elapsedMs: number; exceeded: boolean; sourcesAttempted: number; sourcesCompleted: number; sourcesCancelled: number };
}
export interface StreamEngine { findStreams(request: MediaRequest, options?: QueryOptions): Promise<StreamQueryResult> }
export function isSuccessful(result: StreamQueryResult): boolean {
  return result.streams.length > 0;
}
