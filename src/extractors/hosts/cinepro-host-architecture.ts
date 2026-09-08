import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface CineproPayload { sources?: readonly { url?: string; type?: string }[]; subtitles?: readonly { url?: string; label?: string; format?: string }[] }

export interface CineproHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class CineproApiHostArchitecture implements CineproHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    if (!/<title>CinePro Embed<\/title>/.test(page.text())) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'CinePro player no longer exposes its embed application', stage: 'stage:extraction', sourceId, extractorId: 'cinepro-api', targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: page.status, bodyCaptured: false } } };
    const tokenResponse = await services.request({ url: new URL('/v1/token', player), expectedContent: 'json', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const token = (tokenResponse.json() as { token?: string }).token;
    if (typeof token !== 'string' || !token) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'CinePro public token response did not contain a token', stage: 'stage:extraction', sourceId, extractorId: 'cinepro-api', targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: tokenResponse.status, bodyCaptured: false, parserPath: 'token' } } };
    const endpoint = new URL(media.type === 'movie' ? `/v1/movies/${media.tmdbId}` : `/v1/tv/${media.tmdbId}/seasons/${media.season}/episodes/${media.episode}`, player);
    const response = await services.request({ url: endpoint, expectedContent: 'json', headers: { Authorization: `Bearer ${token}` }, timeoutMs: 30000, stateScope: { kind: 'host', key: player.hostname } }, signal);
    const payload = response.json() as CineproPayload;
    if (!Array.isArray(payload.sources)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'CinePro response did not contain sources', stage: 'stage:extraction', sourceId, extractorId: 'cinepro-api', targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'sources' } } };
    const subtitles = (payload.subtitles ?? []).flatMap(track => track.url ? [{ url: new URL(track.url), ...(track.label && { label: track.label }), ...(track.format && { format: track.format }) }] : []);
    const streams: StreamCandidate[] = payload.sources.flatMap(stream => stream.url && stream.type === 'hls' ? [{ url: new URL(stream.url), protocol: 'hls' as const, ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'cinepro-api', discoveredAt: new Date() }] : []);
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
