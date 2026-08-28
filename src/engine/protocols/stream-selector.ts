import type { Failure, FailureCode, NormalizedStream, RequestServices, SourceHealthHistory, StreamCandidate } from '../core/models';
import { DashInspector, DirectMediaInspector, HlsInspector } from './inspectors';

export interface StreamSelectionOptions { topK: number; preferredLanguages?: readonly string[]; health?: ReadonlyMap<string, SourceHealthHistory> }

export class StreamSelector {
  public constructor(private readonly services: RequestServices) {}
  public preOrder(candidates: readonly StreamCandidate[], options: StreamSelectionOptions): StreamCandidate[] {
    const languageRank = (language?: string) => {
      const rank = language ? options.preferredLanguages?.indexOf(language) ?? -1 : -1;
      return rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
    };
    const healthRank = (id: string) => ({ healthy: 0, degraded: 1, failed: 2 }[options.health?.get(id)?.lastOutcome ?? 'healthy']);
    const protocolRank = (protocol: StreamCandidate['protocol']) => ({ hls: 0, dash: 1, http: 2, unknown: 3 }[protocol]);
    return [...candidates].sort((a, b) => healthRank(a.sourceId) - healthRank(b.sourceId) || languageRank(a.language) - languageRank(b.language) || protocolRank(a.protocol) - protocolRank(b.protocol) || (b.declaredResolution?.height ?? 0) - (a.declaredResolution?.height ?? 0) || (options.health?.get(a.sourceId)?.recentLatencyMs ?? Infinity) - (options.health?.get(b.sourceId)?.recentLatencyMs ?? Infinity) || a.sourceId.localeCompare(b.sourceId) || a.sourceExtractor.localeCompare(b.sourceExtractor) || a.url.href.localeCompare(b.url.href));
  }

  public async validate(candidates: readonly StreamCandidate[], options: StreamSelectionOptions, signal: AbortSignal): Promise<{ streams: NormalizedStream[]; unverified: StreamCandidate[]; failures: Failure[] }> {
    const selected = this.preOrder(candidates, options).slice(0, options.topK);
    const settled = await Promise.all(selected.map(async (candidate) => {
      if (signal.aborted) return { candidate };
      const inspector = candidate.protocol === 'hls' ? new HlsInspector() : candidate.protocol === 'dash' ? new DashInspector() : candidate.protocol === 'http' ? new DirectMediaInspector() : undefined;
      if (!inspector) return { candidate };
      try {
        return { stream: await inspector.inspect(candidate, this.services, signal) };
      } catch (error) {
        const nested = error && typeof error === 'object' && 'failure' in error ? (error as { failure?: Failure }).failure : undefined;
        if (nested) return { failure: { ...nested, stage: 'stage:protocol', sourceId: nested.sourceId ?? candidate.sourceId, extractorId: nested.extractorId ?? candidate.hostExtractor ?? candidate.sourceExtractor, targetHost: nested.targetHost ?? candidate.url.hostname } satisfies Failure };
        const message = error instanceof Error ? error.message : String(error);
        const known = ['MANIFEST_INVALID', 'NO_PLAYABLE_VARIANTS', 'STREAM_EXPIRED'] satisfies readonly FailureCode[];
        const code: FailureCode = known.includes(message as typeof known[number]) ? message as typeof known[number] : candidate.protocol === 'http' ? 'STREAM_EXPIRED' : 'MANIFEST_FETCH_FAILED';
        return { failure: { code, message, stage: 'stage:protocol', sourceId: candidate.sourceId, extractorId: candidate.hostExtractor ?? candidate.sourceExtractor, targetHost: candidate.url.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', finalUrl: candidate.url.href, bodyCaptured: false } } satisfies Failure };
      }
    }));
    const unverified = settled.flatMap(item => item.candidate ? [item.candidate] : []);
    const failures = settled.flatMap(item => item.failure ? [item.failure] : []);
    const streams = [...settled.flatMap(item => item.stream ? [item.stream] : []), ...unverified.flatMap((candidate): NormalizedStream[] => candidate.protocol === 'unknown' ? [] : [{ url: candidate.url, protocol: candidate.protocol, validation: 'unverified', ...(candidate.declaredResolution && { resolution: candidate.declaredResolution }), ...(candidate.language && { language: candidate.language }), ...(candidate.headers && { headers: candidate.headers }), sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }) }])];
    return { streams: this.deduplicate(streams).sort((a, b) => ({ validated: 0, unverified: 1, failed: 2 }[a.validation]) - ({ validated: 0, unverified: 1, failed: 2 }[b.validation]) || (b.resolution?.height ?? 0) - (a.resolution?.height ?? 0) || a.sourceId.localeCompare(b.sourceId) || a.url.href.localeCompare(b.url.href)), unverified, failures };
  }

  public deduplicate(streams: readonly NormalizedStream[]): NormalizedStream[] {
    const keys = new Set<string>();
    return streams.filter((stream) => {
      const canonical = new URL(stream.url);
      canonical.hash = '';
      const key = stream.providerContentId ? `${stream.hostExtractor ?? stream.sourceExtractor}:${stream.providerContentId}` : stream.structuralFingerprint ?? canonical.href;
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    });
  }
}
