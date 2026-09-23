import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidriftSourceResponse {
  streams?: readonly { url?: string; proxyUrl?: string; type?: string; provider?: string }[];
}

export interface VidriftHostArchitecture {
  discover(media: MediaIdentity, player: URL, token: string, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidriftApiHostArchitecture implements VidriftHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, token: string, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const endpoint = new URL(media.type === 'movie' ? `/api/source/movie/${media.tmdbId}` : `/api/source/tv/${media.tmdbId}/${media.season}/${media.episode}`, player);
    endpoint.searchParams.set('token', token);
    endpoint.searchParams.set('provider', 'vaplayer');
    const response = await services.request({ url: endpoint, expectedContent: 'json', stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const payload = response.json() as VidriftSourceResponse;
    if (!Array.isArray(payload.streams)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidrift source response did not contain streams', stage: 'stage:extraction', sourceId, extractorId: 'vidrift-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'streams' } } };
    const streams: StreamCandidate[] = payload.streams.flatMap((stream) => {
      const value = stream.url || stream.proxyUrl;
      return value && stream.type === 'hls' ? [{ url: new URL(value), protocol: 'hls' as const, delivery: 'relayed' as const, sourceId, sourceExtractor, hostExtractor: 'vidrift-api', ...(stream.provider && { label: stream.provider }), discoveredAt: new Date() }] : [];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
