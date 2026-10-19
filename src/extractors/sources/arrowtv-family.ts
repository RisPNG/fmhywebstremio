import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { type CinezoHostArchitecture, CinezoPlayerHostArchitecture } from '../hosts/cinezo-host-architecture';
import { VidloveApiHostArchitecture, type VidloveHostArchitecture } from '../hosts/vidlove-host-architecture';

export class ArrowTvFamily implements SourceFamily {
  public readonly id = 'arrowtv';

  public constructor(private readonly host: VidloveHostArchitecture = new VidloveApiHostArchitecture(), private readonly cinezo: CinezoHostArchitecture = new CinezoPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const html = snapshot.htmlSample ?? '';
    const evidence: FamilyEvidence[] = [];
    if (/<meta name="description" content="Discover and watch the latest movies and TV shows\."/.test(html)) evidence.push({ type: 'script-signature', fingerprint: 'arrowtv-catalog-description' });
    if (/\/watch\/(?:movie|tv)\/\d+/.test(html)) evidence.push({ type: 'route-shape', value: 'arrowtv-tmdb-watch-routes' });
    if (['/movies', '/tv', '/anime'].every(route => html.includes(`href="${route}"`))) evidence.push({ type: 'route-shape', value: 'arrowtv-catalog-nav' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const expectedEmbedPath = `/embed/${media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`}`;
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    let playerFailure: ExtractionResult | undefined;
    let searchFailure: ExtractionResult | undefined;
    let blocked: unknown;
    for (const domain of [source.canonicalDomain, ...source.aliases]) {
      try {
        const search = new URL('/search', `https://${domain}/`);
        search.searchParams.set('q', media.title);
        const searchResponse = await services.request({ url: search, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
        const searchPage = cheerio.load(searchResponse.text());
        const cards = searchPage('a[href^="/movie/"], a[href^="/tv/"]').map((_index, element) => {
          const [type, id] = (searchPage(element).attr('href') ?? '').split('/').slice(1);
          const paragraphs = searchPage(element).find('p').map((_paragraphIndex, paragraph) => searchPage(paragraph).text().trim()).get();
          return { type, id: Number(id), title: paragraphs[0], year: Number(paragraphs[1]?.match(/\d{4}/)?.[0]) };
        }).get();
        if (!cards.length && !searchPage('h1').text().includes('Results for')) {
          searchFailure = { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'ArrowTV search no longer renders its result cards', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: domain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: searchResponse.status, bodyCaptured: false, parserPath: 'search-cards' } } };
          continue;
        }
        if (!cards.some(card => card.id === media.tmdbId
          && card.type === (media.type === 'movie' ? 'movie' : 'tv')
          && card.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
          && (media.type !== 'movie' || media.year === undefined || !card.year || card.year === media.year))) return { type: 'empty', reason: 'not-found' };
        const watch = new URL(media.type === 'movie' ? `/watch/movie/${media.tmdbId}` : `/watch/tv/${media.tmdbId}`, search);
        if (media.type === 'episode') {
          watch.searchParams.set('season', String(media.season));
          watch.searchParams.set('episode', String(media.episode));
        }
        const watchResponse = await services.request({ url: watch, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
        const watchPage = cheerio.load(watchResponse.text());
        const player = watchPage('iframe[src]').map((_index, element) => watchPage(element).attr('src')).get().map(value => new URL(value, watchResponse.finalUrl)).find(url => url.pathname === expectedEmbedPath);
        if (!player) {
          playerFailure = { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'ArrowTV watch page no longer configures its player', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, targetHost: domain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: watchResponse.status, bodyCaptured: false, parserPath: 'watch-player' } } };
          continue;
        }
        if (media.type === 'episode') {
          let token: string | undefined;
          const assets = watchPage('script[src]').map((_index, element) => watchPage(element).attr('src')).get();
          for (const asset of assets) {
            const script = await services.request({ url: new URL(asset, watchResponse.finalUrl), expectedContent: 'text', referrer: watchResponse.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
            const client = script.text();
            if (!client.includes('api.themoviedb.org/3/')) continue;
            const candidate = client.match(/"(eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/)?.[1];
            if (candidate) {
              token = candidate;
              break;
            }
          }
          if (!token) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'ArrowTV watch page no longer exposes its season catalog', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: watchResponse.status, bodyCaptured: false, parserPath: 'watch-season-catalog' } } };
          const seasonUrl = new URL(`https://api.themoviedb.org/3/tv/${media.tmdbId}/season/${media.season}`);
          seasonUrl.searchParams.set('language', 'en-US');
          let season;
          try {
            season = await services.request({ url: seasonUrl, expectedContent: 'json', headers: { authorization: `Bearer ${token}` }, stateScope: { kind: 'source', key: source.id } }, signal);
          } catch (error) {
            if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
            throw error;
          }
          const catalog = season.json() as { season_number?: number; episodes?: readonly { episode_number?: number }[] };
          if (!Array.isArray(catalog.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'ArrowTV season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: season.status, bodyCaptured: false, parserPath: 'episodes' } } };
          if (catalog.season_number !== media.season || !catalog.episodes.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
        }
        const host = player.hostname.startsWith('player.cinezo.') ? this.cinezo : this.host;
        const result = await host.discover(media, player, source.id, this.id, services, signal);
        if (result.type !== 'failure' || result.failure.code !== 'PAGE_STRUCTURE_CHANGED') return result;
        playerFailure = result;
      } catch (error) {
        if (error instanceof TransportFailure) {
          blocked = error;
          continue;
        }
        throw error;
      }
    }
    if (playerFailure) return playerFailure;
    if (searchFailure) return searchFailure;
    if (blocked !== undefined) throw blocked;
    return { type: 'empty', reason: 'not-found' };
  }
}
