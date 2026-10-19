import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { CineproApiHostArchitecture, type CineproHostArchitecture } from '../hosts/cinepro-host-architecture';
import { type VidBoltHostArchitecture, VidBoltPlayerHostArchitecture } from '../hosts/vidbolt-host-architecture';
import { type XpassHostArchitecture, XpassPlayerHostArchitecture } from '../hosts/xpass-host-architecture';

interface AnicineCatalog {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string }[];
  id?: number;
  seasons?: readonly { season_number?: number; episode_count?: number }[];
}

export class AnicineFamily implements SourceFamily {
  public readonly id = 'anicine';

  public constructor(private readonly host: CineproHostArchitecture = new CineproApiHostArchitecture(), private readonly xpass: XpassHostArchitecture = new XpassPlayerHostArchitecture(), private readonly vidbolt: VidBoltHostArchitecture = new VidBoltPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^AniCine\s*[–—-]/i.test($('title').text())) evidence.push({ type: 'script-signature', fingerprint: 'anicine-catalog-brand' });
    if (['/search', '/anime', '/movies', '/tv'].every(path => $(`a[href="${path}"]`).length)) evidence.push({ type: 'route-shape', value: 'anicine-catalog-navigation' });
    if ($('a[href^="/watch/movie/"], a[href^="/watch/tv/"]').length && $('script[src^="/_next/static/chunks/"]').length) evidence.push({ type: 'dom-shape', fingerprint: 'anicine-watch-catalog' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const catalogUrl = new URL('/api/tmdb', `https://${source.canonicalDomain}/`);
    catalogUrl.searchParams.set('path', '/search/multi');
    catalogUrl.searchParams.set('query', media.title);
    const response = await services.request({ url: catalogUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as AnicineCatalog).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'AniCine catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || Number(result.release_date?.slice(0, 4)) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      catalogUrl.searchParams.set('path', `/tv/${media.tmdbId}`);
      catalogUrl.searchParams.delete('query');
      const response = await services.request({ url: catalogUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
      const catalog = response.json() as AnicineCatalog;
      if (catalog.id !== media.tmdbId || !Array.isArray(catalog.seasons)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'AniCine series catalog did not contain the requested series and seasons', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'seasons' } } };
      if (!catalog.seasons.some(season => season.season_number === media.season && typeof season.episode_count === 'number' && media.episode !== undefined && media.episode > 0 && media.episode <= season.episode_count)) return { type: 'empty', reason: 'not-found' };
    }
    const watchUrl = new URL(`/watch/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`, catalogUrl);
    const [home, watch] = await Promise.all([
      services.request({ url: new URL('/', catalogUrl), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal),
      services.request({ url: watchUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal),
    ]);
    const landing = cheerio.load(home.text());
    const commonAssets = new Set(landing('script[src]').map((_index, element) => landing(element).attr('src')).get());
    const player = cheerio.load(watch.text());
    const assets = player('script[src]').map((_index, element) => player(element).attr('src')).get().filter(path => path.startsWith('/_next/static/chunks/') && !commonAssets.has(path));
    for (const asset of assets.slice(0, 8)) {
      const script = await services.request({ url: new URL(asset, watch.finalUrl), expectedContent: 'text', referrer: watch.finalUrl, maxBytes: 1024 * 1024, stateScope: { kind: 'source', key: source.id } }, signal);
      const players = new Map<string, { url: URL; host: CineproHostArchitecture | XpassHostArchitecture | VidBoltHostArchitecture }>();
      for (const configured of script.text().matchAll(new RegExp(`id:"(anicine-1|vidpass|vidbolt)",label:"[^"\\n]+",region:"US",getUrl:[^=]+=>"(https://[^" ]+/${media.type === 'movie' ? 'movie' : 'tv'}/)"`, 'g'))) {
        const url = new URL(`${media.tmdbId}${media.type === 'episode' ? `/${media.season}/${media.episode}` : ''}`, configured[2]);
        const host = url.pathname.startsWith('/e/') ? this.xpass : configured[1] === 'vidbolt' ? this.vidbolt : this.host;
        players.set(url.href, { url, host });
      }
      if (!players.size) continue;
      const results = await Promise.allSettled([...players.values()].map(player => player.host.discover(media, player.url, source.id, this.id, services, signal)));
      const streams = results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []);
      if (streams.length) return { type: 'streams', streams };
      const failure = results.find(result => result.status === 'fulfilled' && result.value.type === 'failure');
      if (failure?.status === 'fulfilled') return failure.value;
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      return { type: 'empty', reason: 'no-streams' };
    }
    return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'AniCine watch page no longer configures a supported player', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: watch.status, bodyCaptured: false, parserPath: 'watch-player-assets' } } };
  }
}
