import type { ExtractionResult, ExtractorFailure, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidlovePayload {
  meta?: { id?: number; season_number?: number; episode_number?: number };
  source?: {
    source?: string;
    label?: string;
    url?: string;
    type?: string;
    headers?: Readonly<Record<string, string>>;
    qualities?: readonly { url?: string; quality?: string; type?: string }[];
  } | null;
  subtitles?: readonly { url?: string; file?: string; label?: string; language?: string; format?: string }[];
}

export interface VidloveHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class VidloveApiHostArchitecture implements VidloveHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const html = page.text();
    const api = html.match(/\bvar\s+API\s*=\s*['"](https:\/\/[^'"]+)['"]/)?.[1];
    const providers = [...new Set([...html.matchAll(/window\.__preResolve\d*\s*=\s*preFor\(['"]([^'"]+)['"]\)/g)].map(match => match[1] as string))];
    if (!api || !providers.length || !/API\s*\+\s*['"]\/movie\?id=/.test(html) || !/API\s*\+\s*['"]\/tv\?id=/.test(html)) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Vidlove player no longer declares its playback API and startup providers', stage: 'stage:extraction', sourceId, extractorId: 'vidlove-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-api' } } };
    const expectedPath = `/embed/${media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`}`;
    if (page.finalUrl.pathname !== expectedPath) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Vidlove player does not match the requested media', stage: 'stage:extraction', sourceId, extractorId: 'vidlove-api', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-route' } } };
    const results = await Promise.allSettled(providers.map((provider) => {
      const endpoint = new URL(media.type === 'movie' ? '/movie' : '/tv', api);
      endpoint.searchParams.set('id', String(media.tmdbId));
      endpoint.searchParams.set('mode', 'json');
      endpoint.searchParams.set('sources', provider);
      if (media.type === 'episode') {
        endpoint.searchParams.set('season', String(media.season));
        endpoint.searchParams.set('episode', String(media.episode));
      }
      return services.request({ url: endpoint, expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'host', key: endpoint.hostname } }, signal);
    }));
    const streams: StreamCandidate[] = [];
    let failure: ExtractorFailure | undefined;
    let transportError: unknown;
    for (const result of results) {
      if (result.status === 'rejected') {
        transportError = result.reason;
        continue;
      }
      const response = result.value;
      const payload = response.json() as VidlovePayload;
      if (!('source' in payload)) {
        failure = { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidlove API response did not contain a source', stage: 'stage:extraction', sourceId, extractorId: 'vidlove-api', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'source' } };
        continue;
      }
      if (!payload.source) continue;
      if (media.type === 'movie' ? payload.meta?.id !== media.tmdbId : payload.meta?.season_number !== media.season || payload.meta?.episode_number !== media.episode) {
        failure = { code: 'RESULT_MAPPING_FAILED', message: 'Vidlove API returned a different movie or episode', stage: 'stage:extraction', sourceId, extractorId: 'vidlove-api', targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'meta' } };
        continue;
      }
      const subtitles = (payload.subtitles ?? []).flatMap((track) => {
        const value = track.url ?? track.file;
        return value ? [{ url: new URL(value, response.finalUrl), ...(track.label && { label: track.label }), ...(track.language && { language: track.language }), ...(track.format && { format: track.format }) }] : [];
      });
      const headers = new Headers(payload.source.headers);
      if (!headers.has('referer')) headers.set('referer', new URL('/', page.finalUrl).href);
      for (const variant of [{ url: payload.source.url, type: payload.source.type, quality: undefined }, ...(payload.source.qualities ?? [])]) {
        if (!variant.url) continue;
        const height = /^4k$/i.test(variant.quality ?? '') ? 2160 : Number(variant.quality?.match(/\d+/)?.[0]);
        streams.push({ url: new URL(variant.url), protocol: variant.type === 'hls' || /\.m3u8(?:$|\?)/i.test(variant.url) ? 'hls' : variant.type === 'dash' || /\.mpd(?:$|\?)/i.test(variant.url) ? 'dash' : 'http', delivery: 'relayed', headers: Object.fromEntries(headers.entries()), ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), ...(variant.quality && { label: variant.quality }), ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'vidlove-api', discoveredAt: new Date() });
      }
    }
    if (streams.length) return { type: 'streams', streams };
    if (failure) return { type: 'failure', failure };
    if (transportError) throw transportError;
    return { type: 'empty', reason: 'no-streams' };
  }
}
