import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidriftSourceResponse {
  streams?: readonly { url?: string; proxyUrl?: string; type?: string; provider?: string }[];
}

export interface VidriftHostArchitecture {
  discover(media: MediaIdentity, player: URL, token: string, referrer: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidriftApiHostArchitecture implements VidriftHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, token: string, referrer: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const mediaPath = media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`;
    const bootUrl = new URL(`/api/boot/${mediaPath}`, player);
    bootUrl.searchParams.set('token', token);
    bootUrl.searchParams.set('shell', '1');
    const boot = await services.request({ url: bootUrl, headers: { 'x-embed-parent': referrer.origin }, referrer, expectedContent: 'json', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const playbackToken = (boot.json() as { meta?: { playbackToken?: string } }).meta?.playbackToken;
    if (typeof playbackToken !== 'string' || !playbackToken) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidrift player boot did not contain its playback token', stage: 'stage:extraction', sourceId, extractorId: 'vidrift-api', targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: boot.status, bodyCaptured: false, parserPath: 'meta.playbackToken' } } };
    const endpoint = new URL(`/api/source/${mediaPath}`, player);
    endpoint.searchParams.set('token', playbackToken);
    endpoint.searchParams.set('provider', '');
    const response = await services.request({ url: endpoint, expectedContent: 'json', stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const payload = response.json() as VidriftSourceResponse;
    if (!Array.isArray(payload.streams)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidrift source response did not contain streams', stage: 'stage:extraction', sourceId, extractorId: 'vidrift-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'streams' } } };
    const streams: StreamCandidate[] = payload.streams.flatMap((stream) => {
      const value = stream.url || stream.proxyUrl;
      return value && stream.type === 'hls' ? [{ url: new URL(value, player), protocol: 'hls' as const, delivery: 'relayed' as const, sourceId, sourceExtractor, hostExtractor: 'vidrift-api', ...(stream.provider && { label: stream.provider }), discoveredAt: new Date() }] : [];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
