import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';

interface VidboxSuggestResponse {
  data?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string }[];
}

export class VidboxFamily implements SourceFamily {
  public readonly id = 'vidbox';

  public constructor(private readonly host: SpeedracelightHostArchitecture = new SpeedracelightApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const html = snapshot.htmlSample ?? '';
    const evidence: FamilyEvidence[] = [];
    if (/Your Ultimate Streaming Guide<\/title>/i.test(html) && /content="Discover and track your favorite movies and TV shows across all streaming platforms\./i.test(html)) evidence.push({ type: 'script-signature', fingerprint: 'vidbox-streaming-guide' });
    if (/href="\/search\?type=movie"/i.test(html) && /href="\/search\?type=tv"/i.test(html) && snapshot.routeHints.includes('/watchlist')) evidence.push({ type: 'route-shape', value: '/search?type=movie|tv' });
    if (snapshot.assetPaths.some(path => /^\/_next\/static\/(?:chunks|css)\//i.test(path))) evidence.push({ type: 'asset-path', value: 'vidbox-next-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const catalogUrl = new URL('/api/search/suggest', `https://${source.canonicalDomain}/`);
    catalogUrl.searchParams.set('q', media.title);
    const response = await services.request({ url: catalogUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as VidboxSuggestResponse).data;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidbox catalog suggestions did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'data' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || !result.release_date || Number(result.release_date.slice(0, 4)) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      const details = await services.request({ url: new URL(`/tv/${media.tmdbId}`, catalogUrl), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
      const html = details.text();
      const seasons = [...html.matchAll(/\\"episode_count\\":(\d+),[\s\S]*?\\"season_number\\":(\d+),/g)];
      if (!html.includes(`\\"id\\":${media.tmdbId},`) || !seasons.length) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Vidbox series page no longer exposes the requested series and its seasons', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: details.status, finalUrl: details.finalUrl.toString(), bodyCaptured: false, parserPath: 'seasons' } } };
      if (!seasons.some(season => Number(season[2]) === media.season && media.episode !== undefined && media.episode > 0 && media.episode <= Number(season[1]))) return { type: 'empty', reason: 'not-found' };
    }
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
