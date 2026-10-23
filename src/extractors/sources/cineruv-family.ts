import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

interface CineruvCatalogEntry {
  id?: number;
  title?: string;
  type?: string;
  year?: number;
  language?: string;
  seasons?: readonly { seasonNumber?: number }[];
}

interface CineruvSource {
  id?: string;
  url?: string;
  type?: string;
  quality?: string;
  language?: string;
}

interface CineruvStreamResponse {
  success?: boolean;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  primarySources?: readonly CineruvSource[];
  allProviders?: Readonly<Record<string, readonly CineruvSource[]>>;
}

export class CineruvFamily implements SourceFamily {
  public readonly id = 'cineruv';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('title').text().trim().toLowerCase() === 'cineruv') evidence.push({ type: 'script-signature', fingerprint: 'cineruv-brand' });
    if ($('meta[property="og:site_name"]').attr('content')?.toLowerCase() === 'cineruv'
      && $('meta[property="og:url"]').attr('content') === 'https://cineruv.website') evidence.push({ type: 'dom-shape', fingerprint: 'cineruv-catalog-identity' });
    if ($('#root').length && $('script[type="module"][src^="/assets/index-"]').length) evidence.push({ type: 'asset-path', value: 'cineruv-vite-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const home = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(home.text());
    const client = $('script[type="module"][src]').attr('src');
    const asset = client ? await services.request({ url: new URL(client, home.finalUrl), expectedContent: 'text', referrer: home.finalUrl, maxBytes: 2 * 1024 * 1024, stateScope: { kind: 'source', key: source.id } }, signal) : undefined;
    const script = asset?.text() ?? '';
    const configured = script.match(/\breturn["'](https:\/\/[^"']+)["']\.replace\(\/\\\/\+\$\//)?.[1];
    if (!configured || !script.includes('/api/media/search') || !script.includes('/api/stream') || !script.includes('primarySources')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Cineruv application no longer declares its catalog and playback API', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: home.status, bodyCaptured: false, parserPath: 'client-api' } } };
    const api = new URL(configured);
    const headers = { Accept: 'application/json', origin: home.finalUrl.origin, referer: home.finalUrl.href };
    const type = media.type === 'movie' ? 'movie' : 'tv';
    const search = new URL('/api/media/search', api);
    search.searchParams.set('q', media.title);
    const response = await services.request({ url: search, expectedContent: 'json', headers, referrer: home.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as { results?: readonly CineruvCatalogEntry[] }).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cineruv catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId && result.type === type
      && result.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && (media.type !== 'movie' || media.year === undefined || result.year === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    const details = await services.request({ url: new URL(`/api/media/${type}/${media.tmdbId}`, api), expectedContent: 'json', headers, referrer: home.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const catalog = details.json() as CineruvCatalogEntry;
    if (catalog.id !== media.tmdbId || catalog.type !== type
      || catalog.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== expectedTitle
      || (media.type === 'movie' && media.year !== undefined && catalog.year !== media.year)) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      if (!Array.isArray(catalog.seasons)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cineruv series catalog did not contain seasons', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: details.status, bodyCaptured: false, parserPath: 'seasons' } } };
      if (!catalog.seasons.some(season => season.seasonNumber === media.season)) return { type: 'empty', reason: 'not-found' };
      const seasonResponse = await services.request({ url: new URL(`/api/media/tv/${media.tmdbId}/season/${media.season}`, api), expectedContent: 'json', headers, referrer: home.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
      const season = seasonResponse.json() as { seasonNumber?: number; episodes?: readonly { episodeNumber?: number }[] };
      if (!Array.isArray(season.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cineruv season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: seasonResponse.status, bodyCaptured: false, parserPath: 'episodes' } } };
      if (season.seasonNumber !== media.season || !season.episodes.some(episode => episode.episodeNumber === media.episode)) return { type: 'empty', reason: 'not-found' };
    }
    const playback = new URL('/api/stream', api);
    playback.searchParams.set('tmdbId', String(media.tmdbId));
    playback.searchParams.set('type', type);
    playback.searchParams.set('title', catalog.title as string);
    if (catalog.year !== undefined) playback.searchParams.set('year', String(catalog.year));
    if (media.type === 'episode') {
      playback.searchParams.set('season', String(media.season));
      playback.searchParams.set('episode', String(media.episode));
    }
    if (catalog.language) playback.searchParams.set('language', catalog.language.toLowerCase());
    const streamResponse = await services.request({ url: playback, expectedContent: 'json', headers, referrer: home.finalUrl, timeoutMs: 20000, stateScope: { kind: 'source', key: source.id } }, signal);
    const payload = streamResponse.json() as CineruvStreamResponse;
    if (payload.success === false) return { type: 'empty', reason: 'no-streams' };
    if (payload.success !== true || !Array.isArray(payload.primarySources)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cineruv playback response did not contain primary sources', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: streamResponse.status, bodyCaptured: false, parserPath: 'primarySources' } } };
    if (payload.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== expectedTitle
      || (media.type === 'movie' ? media.year !== undefined && payload.year !== media.year : payload.season !== media.season || payload.episode !== media.episode)) return { type: 'empty', reason: 'not-found' };
    const identities = new Set<string>();
    const streams: StreamCandidate[] = [...payload.primarySources, ...Object.values(payload.allProviders ?? {}).flat()].flatMap((stream) => {
      if (!stream.url || stream.type !== 'hls') return [];
      const identity = stream.id ?? stream.url;
      if (identities.has(identity)) return [];
      identities.add(identity);
      const url = new URL(stream.url, api);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return [];
      return [{ url, protocol: 'hls', delivery: 'relayed', headers: { origin: home.finalUrl.origin, referer: home.finalUrl.href }, ...(stream.quality && { label: stream.quality }), ...(stream.language && { language: stream.language }), sourceId: source.id, sourceExtractor: this.id, discoveredAt: new Date() }];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
