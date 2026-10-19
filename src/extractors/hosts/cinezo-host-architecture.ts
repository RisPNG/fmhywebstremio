import * as cheerio from 'cheerio';
import type { ExtractionResult, MediaIdentity, RequestServices } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';

interface CinezoPlaybackResponse {
  title?: string;
  year?: number;
  type?: string;
  series?: string;
  season?: number;
  episode?: number;
  direct_playable?: boolean;
  stream?: { original?: string; remux?: string; hls?: string };
  quality?: { resolution?: string };
  subtitles?: readonly { url?: string; file?: string; label?: string; language?: string; format?: string }[];
}

export interface CinezoHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class CinezoPlayerHostArchitecture implements CinezoHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const mediaPath = media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`;
    if (page.finalUrl.pathname !== `/embed/${mediaPath}`) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Cinezo player does not match the requested media', stage: 'stage:extraction', sourceId, extractorId: 'cinezo-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-route' } } };
    const $ = cheerio.load(page.text());
    const assets = $('script[type="module"][src]').map((_index, element) => $(element).attr('src')).get();
    for (const asset of assets) {
      const script = await services.request({ url: new URL(asset, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
      const client = script.text();
      const endpoint = client.match(/`(https:\/\/[^`/]+)\/movie\/\$\{[\w$]+\}\.json`/)?.[1];
      if (!endpoint || !/\{id:"jennifer",label:"Jennifer"/.test(client) || !/\/tv\/\$\{[\w$]+\}\/\$\{[\w$]+\}\/\$\{[\w$]+\}\.json`/.test(client)) continue;
      let response;
      try {
        response = await services.request({ url: new URL(`/${mediaPath}.json`, endpoint), expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'host', key: new URL(endpoint).hostname } }, signal);
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
        throw error;
      }
      const payload = response.json() as CinezoPlaybackResponse;
      if (!payload.stream) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinezo playback response did not contain streams', stage: 'stage:extraction', sourceId, extractorId: 'cinezo-player', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'stream' } } };
      const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const actualTitle = (media.type === 'movie' ? payload.title : payload.series)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      if (actualTitle !== expectedTitle || payload.type !== (media.type === 'movie' ? 'Movie' : 'Episode') || (media.type === 'movie' && media.year !== undefined && payload.year !== media.year) || (media.type === 'episode' && (payload.season !== media.season || payload.episode !== media.episode))) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Cinezo playback response does not match the requested media', stage: 'stage:extraction', sourceId, extractorId: 'cinezo-player', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'playback-identity' } } };
      const value = (payload.direct_playable ? payload.stream.original : undefined) || payload.stream.hls || payload.stream.remux || payload.stream.original;
      if (!value) return { type: 'empty', reason: 'no-streams' };
      const subtitles = (payload.subtitles ?? []).flatMap((track) => {
        const url = track.url ?? track.file;
        return url ? [{ url: new URL(url, response.finalUrl), ...(track.label && { label: track.label }), ...(track.language && { language: track.language }), ...(track.format && { format: track.format }) }] : [];
      });
      const resolution = payload.quality?.resolution?.match(/^(\d+)x(\d+)$/);
      return { type: 'streams', streams: [{ url: new URL(value), protocol: value === payload.stream.hls ? 'hls' : 'http', delivery: 'relayed', headers: { referer: new URL('/', page.finalUrl).href }, ...(resolution && { declaredResolution: { width: Number(resolution[1]), height: Number(resolution[2]) } }), ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'cinezo-player', label: 'Jennifer', discoveredAt: new Date() }] };
    }
    return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Cinezo player no longer declares its native playback endpoint', stage: 'stage:extraction', sourceId, extractorId: 'cinezo-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-client' } } };
  }
}
