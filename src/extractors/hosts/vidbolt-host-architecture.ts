import * as cheerio from 'cheerio';
import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidBoltConfiguration {
  title?: { type?: string; id?: string; season?: string; episode?: string };
  name?: string;
  sub?: string;
  servers?: readonly { id?: string }[];
}

interface VidBoltPlaybackResponse {
  stream?: { server?: string; sources?: readonly { url?: string; kind?: string; quality?: string; language?: string | null }[] } | null;
}

export interface VidBoltHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidBoltPlayerHostArchitecture implements VidBoltHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const $ = cheerio.load(page.text());
    const inline = $('script:not([src])').map((_index, element) => $(element).text()).get().find(script => script.includes('window.__VB__='));
    const configuration = inline?.match(/window\.__VB__=(\{[^\n]+?\});var q="([^"]+)"/);
    const endpointPath = inline?.match(/window\.__vbStream=fetch\('([^']+)'\+q\)/)?.[1];
    if (!configuration || !endpointPath || !endpointPath.endsWith('?')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'VidBolt player no longer declares its media configuration and resolver', stage: 'stage:extraction', sourceId, extractorId: 'vidbolt-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-configuration' } } };
    const configured = JSON.parse(configuration[1] as string) as VidBoltConfiguration;
    const endpoint = new URL(endpointPath + configuration[2], page.finalUrl);
    const type = media.type === 'movie' ? 'movie' : 'tv';
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (configured.title?.type !== type || configured.title.id !== String(media.tmdbId) || configured.name?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== expectedTitle || endpoint.searchParams.get('type') !== type || endpoint.searchParams.get('id') !== String(media.tmdbId) || (media.type === 'episode' && (configured.title.season !== String(media.season) || configured.title.episode !== String(media.episode) || endpoint.searchParams.get('season') !== String(media.season) || endpoint.searchParams.get('episode') !== String(media.episode))) || (media.type === 'movie' && media.year !== undefined && configured.sub !== String(media.year))) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'VidBolt player does not match the requested movie or episode', stage: 'stage:extraction', sourceId, extractorId: 'vidbolt-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-identity' } } };
    const response = await services.request({ url: endpoint, expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    const payload = response.json() as VidBoltPlaybackResponse;
    if (!('stream' in payload) || (payload.stream && !Array.isArray(payload.stream.sources))) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'VidBolt resolver response did not contain its stream sources', stage: 'stage:extraction', sourceId, extractorId: 'vidbolt-player', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'stream.sources' } } };
    if (!payload.stream) return { type: 'empty', reason: 'no-streams' };
    if (!configured.servers?.some(server => server.id === payload.stream?.server)) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'VidBolt resolver returned a server absent from the player', stage: 'stage:extraction', sourceId, extractorId: 'vidbolt-player', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'stream.server' } } };
    const streams: StreamCandidate[] = (payload.stream.sources ?? []).flatMap((source) => {
      if (!source.url) return [];
      const height = /^4k$/i.test(source.quality ?? '') ? 2160 : Number(source.quality?.match(/\d+/)?.[0]);
      return [{ url: new URL(source.url, response.finalUrl), protocol: source.kind === 'hls' ? 'hls' as const : source.kind === 'dash' ? 'dash' as const : 'http' as const, delivery: 'relayed' as const, headers: { referer: new URL('/', page.finalUrl).href }, ...(source.language && { language: source.language }), ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), ...(source.quality && { label: source.quality }), sourceId, sourceExtractor, hostExtractor: 'vidbolt-player', discoveredAt: new Date() }];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
