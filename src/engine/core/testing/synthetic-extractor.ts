import type { ExtractionResult, ExtractionTarget, Extractor, MatchResult, RequestServices } from '../models';

export class SyntheticExtractor implements Extractor {
  public readonly id = 'synthetic';
  public match(target: ExtractionTarget): MatchResult | null { return target.url.protocol === 'synthetic:' ? { matcherId: 'synthetic', confidence: 1 } : null; }
  public async extract(target: ExtractionTarget, _services: RequestServices, _signal: AbortSignal): Promise<ExtractionResult> {
    void _services;
    void _signal;
    switch (target.url.pathname) {
      case '/streams': return { type: 'streams', streams: [{ url: new URL('https://cdn.example/master.m3u8'), protocol: 'hls', sourceId: 'synthetic-source', sourceExtractor: this.id, discoveredAt: new Date(0) }] };
      case '/redirect': return { type: 'redirect', target: { url: new URL('synthetic://fixture/streams'), kind: 'embed' } };
      case '/embeds': return { type: 'embeds', targets: [{ url: new URL('synthetic://fixture/streams'), kind: 'embed' }] };
      case '/empty': return { type: 'empty', reason: 'no-streams' };
      case '/failure': return { type: 'failure', failure: { code: 'NO_STREAM_CANDIDATE', message: 'synthetic expected failure', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } } };
      default: return { type: 'empty', reason: 'not-found' };
    }
  }
}

export function describeExtractionResult(result: ExtractionResult): string {
  switch (result.type) {
    case 'streams': return `streams:${result.streams.length}`;
    case 'redirect': return `redirect:${result.target.url.href}`;
    case 'embeds': return `embeds:${result.targets.length}`;
    case 'empty': return `empty:${result.reason}`;
    case 'failure': return `failure:${result.failure.code}`;
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}
