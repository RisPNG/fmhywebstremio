import * as cheerio from 'cheerio';
import type { ExtractionResult, ExtractorFailure, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';

interface VidsparkPayload {
  result?: boolean;
  type?: string;
  tmdb_id?: string;
  year?: number;
  season?: number;
  episode?: number;
  sources?: readonly {
    url?: string;
    tracks?: readonly { file?: string; label?: string }[];
    qualities?: readonly { url?: string; height?: number }[];
  }[];
}

export interface VidsparkHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidsparkApiHostArchitecture implements VidsparkHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const route = media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`;
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const $ = cheerio.load(page.text());
    let client: string | undefined;
    for (const asset of $('script[type="module"][src]').map((_index, element) => $(element).attr('src')).get()) {
      const script = await services.request({ url: new URL(asset, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, maxBytes: 4 * 1024 * 1024, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
      if (script.text().includes('fetch(`/api/vidora${')) {
        client = script.text();
        break;
      }
    }
    const keyName = client?.match(/fetch\(`\/api\/vidora\$\{[\w$]+\}`,\{headers:\{"x-player-key":([\w$]+)\}\}\)/)?.[1];
    const key = keyName && client?.match(new RegExp(`(?:^|[^\\w$])${keyName.replaceAll('$', '\\$')}=\`([a-f0-9]{64})\``))?.[1];
    const serverRoute = client !== undefined && /`\/v1\/movie\/\$\{[\w$.]+\}\?source=\$\{[\w$]+\}`/.test(client);
    const servers = serverRoute ? [...(client as string).matchAll(/\{key:`([\w-]+)`,label:`[^`]*`/g)].map(match => match[1]) : [undefined];
    if (!client || !key || !(serverRoute ? servers.length : /`\/v1\/movie\/\$\{[\w$.]+\}`/.test(client))) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'VidSpark player no longer declares its Vidora API', stage: 'stage:extraction', sourceId, extractorId: 'vidspark-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-client' } } };
    if (page.finalUrl.pathname !== `/${route}`) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'VidSpark player does not match the requested media', stage: 'stage:extraction', sourceId, extractorId: 'vidspark-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-route' } } };
    const fallbackName = client.match(/`\$\{([\w$]+)\}\/tv\/\$\{[\w$]+\.id\}\/\$\{[\w$]+\.season\}\/\$\{[\w$]+\.episode\}`:`\$\{\1\}\/movie\/\$\{[\w$]+\.id\}`/)?.[1];
    const fallback = fallbackName && client.match(new RegExp(`(?:^|[^\\w$])${fallbackName.replaceAll('$', '\\$')}=\`(https:\\/\\/[^\`]+)\``))?.[1];
    const fallbackResults = Promise.allSettled(fallback ? [this.discover(media, new URL(`/${route}`, fallback), sourceId, sourceExtractor, services, signal)] : []);
    const streams: StreamCandidate[] = [];
    let failure: ExtractorFailure | undefined;
    let transportError: unknown;
    try {
      for (const server of servers) {
        const endpoint = new URL(`/api/vidora/v1/${route}`, page.finalUrl);
        if (server) endpoint.searchParams.set('source', server);
        let payload: VidsparkPayload;
        try {
          payload = (await services.request({ url: endpoint, expectedContent: 'json', headers: { 'x-player-key': key }, referrer: page.finalUrl, stateScope: { kind: 'host', key: endpoint.hostname } }, signal)).json() as VidsparkPayload;
        } catch (error) {
          if (!(error instanceof TransportFailure)) throw error;
          if (error.failure.code !== 'HTTP_NOT_FOUND') transportError = error;
          continue;
        }
        const stream = payload.sources?.[0];
        if (payload.result !== true || !stream?.url) continue;
        if (payload.tmdb_id !== String(media.tmdbId) || payload.type !== (media.type === 'movie' ? 'movie' : 'tv') || (media.type === 'movie' ? media.year !== undefined && payload.year !== undefined && payload.year !== media.year : payload.season !== media.season || payload.episode !== media.episode)) {
          failure = { code: 'RESULT_MAPPING_FAILED', message: 'VidSpark API returned a different movie or episode', stage: 'stage:extraction', sourceId, extractorId: 'vidspark-api', targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'identity' } };
          continue;
        }
        const subtitles = (stream.tracks ?? []).flatMap(track => track.file ? [{ url: new URL(track.file, page.finalUrl), ...(track.label && { label: track.label }) }] : []);
        for (const variant of [{ url: stream.url, height: undefined }, ...(stream.qualities && stream.qualities.length > 1 ? stream.qualities : [])]) {
          if (!variant.url) continue;
          const url = new URL(variant.url, page.finalUrl);
          const proxied = url.searchParams.get('url');
          const declared = proxied ? url.searchParams.get('data') : null;
          const headers = declared ? Object.fromEntries(Buffer.from(declared, 'base64').toString().split('|').map(header => [header.slice(0, header.indexOf('=')).toLowerCase(), header.slice(header.indexOf('=') + 1)])) : proxied ? {} : { referer: new URL('/', page.finalUrl).href };
          const path = new URL(proxied ?? url.href).pathname;
          streams.push({ url: new URL(proxied ?? url.href), protocol: /\.m3u8$/i.test(path) ? 'hls' : /\.mpd$/i.test(path) ? 'dash' : 'http', delivery: 'relayed', headers, ...(variant.height && { declaredResolution: { width: Math.round(variant.height * 16 / 9), height: variant.height } }), ...(variant.height && { label: `${variant.height}p` }), ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'vidspark-api', discoveredAt: new Date() });
        }
        break;
      }
    } catch (error) {
      await fallbackResults;
      throw error;
    }
    const [next] = await fallbackResults;
    if (next?.status === 'fulfilled' && next.value.type === 'streams') streams.push(...next.value.streams);
    if (next?.status === 'fulfilled' && next.value.type === 'failure' && next.value.failure.code === 'RESULT_MAPPING_FAILED') failure ??= next.value.failure;
    if (next?.status === 'rejected') transportError ??= next.reason;
    if (streams.length) return { type: 'streams', streams };
    if (failure) return { type: 'failure', failure };
    if (transportError) throw transportError;
    return { type: 'empty', reason: 'no-streams' };
  }
}
