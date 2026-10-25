import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

interface MovieNerdsStreamResponse {
  success?: boolean;
  tmdbId?: number;
  type?: string;
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  sources?: readonly { url?: string; rawUrl?: string; type?: string; quality?: string; isDirect?: boolean; language?: string }[];
  subtitles?: readonly { url?: string; label?: string; language?: string }[];
}

export class MovieNerdsFamily implements SourceFamily {
  public readonly id = 'movienerds';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^MovieNerds\s*[–—-]/i.test($('title').text())) evidence.push({ type: 'script-signature', fingerprint: 'movienerds-brand' });
    if (/location\.replace\('https:\/\/movienerds\.site'\s*\+\s*window\.location\.pathname/.test(snapshot.htmlSample ?? '')) evidence.push({ type: 'script-signature', fingerprint: 'movienerds-canonical-host' });
    if ($('script[type="module"][src^="/assets/index-"]').length && $('#root').length) evidence.push({ type: 'dom-shape', fingerprint: 'movienerds-vite-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const home = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(home.text());
    const client = $('script[type="module"][src]').attr('src');
    const script = client ? await services.request({ url: new URL(client, home.finalUrl), expectedContent: 'text', referrer: home.finalUrl, maxBytes: 2 * 1024 * 1024, stateScope: { kind: 'source', key: source.id } }, signal) : undefined;
    const configured = script?.text().match(/[\w$]+=`(https:\/\/[^`]+)`,[\w$]+=\{Accept:`application\/json`,"x-client-app":`([^`]+)`,"x-app-key":`([^`]+)`\}/);
    if (!configured || !script?.text().includes('/api/stream?')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'MovieNerds application no longer declares its stream API', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: home.status, bodyCaptured: false, parserPath: 'client-api' } } };
    const api = new URL(configured[1] as string);
    const endpoint = new URL('/api/stream', api);
    endpoint.searchParams.set('tmdbId', String(media.tmdbId));
    endpoint.searchParams.set('type', media.type === 'movie' ? 'movie' : 'tv');
    endpoint.searchParams.set('lang', 'en');
    endpoint.searchParams.set('title', media.title);
    if (media.year) endpoint.searchParams.set('year', String(media.year));
    if (media.imdbId) endpoint.searchParams.set('imdbId', media.imdbId);
    if (media.type === 'episode') {
      endpoint.searchParams.set('season', String(media.season));
      endpoint.searchParams.set('episode', String(media.episode));
    }
    const response = await services.request({ url: endpoint, expectedContent: 'json', headers: { 'Accept': 'application/json', 'x-client-app': configured[2] as string, 'x-app-key': configured[3] as string }, timeoutMs: 30000, stateScope: { kind: 'source', key: source.id } }, signal);
    const payload = response.json() as MovieNerdsStreamResponse;
    if (payload.success !== true || !Array.isArray(payload.sources)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'MovieNerds stream response did not contain sources', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, targetHost: endpoint.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'sources' } } };
    if (payload.tmdbId !== media.tmdbId
      || payload.type !== (media.type === 'movie' ? 'movie' : 'tv')
      || payload.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      || (media.type === 'movie' ? media.year !== undefined && payload.year !== media.year : payload.season !== media.season || payload.episode !== media.episode)) return { type: 'empty', reason: 'not-found' };
    const subtitles = (payload.subtitles ?? []).flatMap(track => track.url ? [{ url: new URL(track.url, api), ...(track.label && { label: track.label }), ...(track.language && { language: track.language }) }] : []);
    const streams: StreamCandidate[] = payload.sources.flatMap((stream) => {
      if (!stream.url || stream.type !== 'hls' || stream.isDirect === false) return [];
      const url = String(stream.url).toLowerCase();
      const rawUrl = String(stream.rawUrl ?? '').toLowerCase();
      if ((!url.startsWith('http://') && !url.startsWith('https://')) || url.includes('unavailable') || rawUrl.includes('unavailable')) return [];
      const candidates = [url, rawUrl].flatMap((value) => {
        try {
          return [value, decodeURIComponent(value)];
        } catch {
          return [value];
        }
      });
      if (['apopheniaatlas.site', 'apophenia', 'lifestylefreedomlab.site', 'aoneroom.com/other', '/other/202', 'mb=1', 'b164fbfb4347792950bdfbfb563d39d9', 'dummy', 'teaser', 'trailer', 'promo', 'sample', 'staticreverie.site', 'staticreverie'].some(marker => candidates.some(value => value.includes(marker)))) return [];
      const height = Number(stream.quality?.match(/(\d{3,4})p/i)?.[1]);
      return [{ url: new URL(stream.url), protocol: 'hls' as const, delivery: 'relayed' as const, ...(stream.language && { language: stream.language }), ...(stream.quality && { label: stream.quality }), ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), ...(subtitles.length && { subtitles }), sourceId: source.id, sourceExtractor: this.id, discoveredAt: new Date() }];
    });
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
