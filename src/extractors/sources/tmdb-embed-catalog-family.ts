import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';

interface TmdbCatalogResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string; poster_path?: string | null }[];
  id?: number;
  seasons?: readonly { season_number?: number; episode_count?: number }[];
}

export class TmdbEmbedCatalogFamily implements SourceFamily {
  public readonly id = 'tmdb-embed-catalog';

  public constructor(private readonly host: SpeedracelightHostArchitecture = new SpeedracelightApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const html = snapshot.htmlSample ?? '';
    const evidence: FamilyEvidence[] = [];
    if (/const TMDB_KEY\s*=\s*['"][a-z0-9]+['"]/.test(html) && /const TMDB_BASE\s*=\s*['"]https:\/\/api\.themoviedb\.org\/3['"]/.test(html)) evidence.push({ type: 'api-shape', fingerprint: 'tmdb-client-catalog' });
    if (/tmdb\(['"]\/search\/multi['"]/.test(html) && /async function loadTVSeasons\(id\)/.test(html)) evidence.push({ type: 'script-signature', fingerprint: 'tmdb-search-season-catalog' });
    if (/https:\/\/player\.videasy\.net\/movie\/\$\{id\}/.test(html) && /https:\/\/player\.videasy\.net\/tv\/\$\{id\}\/\$\{s\}\/\$\{e\}/.test(html)) evidence.push({ type: 'route-shape', value: 'videasy-movie-episode-players' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const page = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const html = page.text();
    const key = html.match(/const TMDB_KEY\s*=\s*['"]([a-z0-9]+)['"]/)?.[1];
    if (!key || !this.classify(source, { finalUrl: page.finalUrl, status: page.status, headers: page.headers, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] })) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'TMDB embed catalog no longer exposes its catalog and Videasy player configuration', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: page.status, bodyCaptured: false } } };
    const catalogUrl = new URL('https://api.themoviedb.org/3/search/multi');
    catalogUrl.searchParams.set('api_key', key);
    catalogUrl.searchParams.set('language', 'en-US');
    catalogUrl.searchParams.set('query', media.title);
    catalogUrl.searchParams.set('page', '1');
    const response = await services.request({ url: catalogUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as TmdbCatalogResponse).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'TMDB embed catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && result.poster_path
      && (media.type !== 'movie' || media.year === undefined || !result.release_date || Number(result.release_date.slice(0, 4)) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      catalogUrl.pathname = `/3/tv/${media.tmdbId}`;
      catalogUrl.searchParams.delete('query');
      catalogUrl.searchParams.delete('page');
      const details = await services.request({ url: catalogUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
      const catalog = details.json() as TmdbCatalogResponse;
      if (catalog.id !== media.tmdbId || !Array.isArray(catalog.seasons)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'TMDB embed series catalog did not contain the requested series and seasons', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: details.status, bodyCaptured: false, parserPath: 'seasons' } } };
      if (!catalog.seasons.some(season => season.season_number === media.season && typeof season.episode_count === 'number' && media.episode !== undefined && media.episode > 0 && media.episode <= season.episode_count)) return { type: 'empty', reason: 'not-found' };
    }
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
