import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { type CinezoHostArchitecture, CinezoPlayerHostArchitecture } from '../hosts/cinezo-host-architecture';
import { type VidBoltHostArchitecture, VidBoltPlayerHostArchitecture } from '../hosts/vidbolt-host-architecture';
import { VidloveApiHostArchitecture, type VidloveHostArchitecture } from '../hosts/vidlove-host-architecture';

interface FlyflixCatalogResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string }[];
  season_number?: number;
  episodes?: readonly { episode_number?: number }[];
}

export class FlyflixFamily implements SourceFamily {
  public readonly id = 'flyflix';

  public constructor(private readonly vidlove: VidloveHostArchitecture = new VidloveApiHostArchitecture(), private readonly cinezo: CinezoHostArchitecture = new CinezoPlayerHostArchitecture(), private readonly vidbolt: VidBoltHostArchitecture = new VidBoltPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^flyflix\b/i.test($('title').text().trim())) evidence.push({ type: 'script-signature', fingerprint: 'flyflix-brand' });
    if ($('meta[property="og:site_name"]').attr('content')?.toLowerCase() === 'flyflix' && /all-in-one entertainment hub/i.test($('meta[name="description"]').attr('content') ?? '')) evidence.push({ type: 'dom-shape', fingerprint: 'flyflix-catalog-identity' });
    if ($('#root').length && $('script[type="module"][src^="/assets/index-"]').length) evidence.push({ type: 'asset-path', value: 'flyflix-vite-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const home = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const client = cheerio.load(home.text())('script[type="module"][src]').attr('src');
    const asset = client ? await services.request({ url: new URL(client, home.finalUrl), expectedContent: 'text', referrer: home.finalUrl, maxBytes: 2 * 1024 * 1024, stateScope: { kind: 'source', key: source.id } }, signal) : undefined;
    const script = asset?.text() ?? '';
    const token = script.match(/"(eyJhbGciOi[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)"/)?.[1];
    const hosts = { vidbolt: this.vidbolt, cinezo: this.cinezo, vidlove: this.vidlove };
    const players = Object.entries(hosts).flatMap(([key, host]) => {
      const paths = script.match(new RegExp(`case"${key}":return [\\w$]+==="movie"\\?\`(https://[^\`$]+/)\\$\\{[\\w$]+\\}\`:\`(https://[^\`$]+/)\\$\\{[\\w$]+\\}/\\$\\{[\\w$]+\\}/\\$\\{[\\w$]+\\}\``));
      return paths && script.includes(`{id:"${key}"`) ? [{ host, url: new URL(`${media.tmdbId}${media.type === 'episode' ? `/${media.season}/${media.episode}` : ''}`, paths[media.type === 'movie' ? 1 : 2]) }] : [];
    });
    if (!token || !script.includes('https://api.themoviedb.org/3') || !script.includes('search/multi?query=') || !players.length) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Flyflix application no longer declares its catalog and players', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: home.status, bodyCaptured: false, parserPath: 'client-catalog-players' } } };
    const headers = { authorization: `Bearer ${token}` };
    const search = new URL('https://api.themoviedb.org/3/search/multi');
    search.searchParams.set('query', media.title);
    search.searchParams.set('language', 'en-US');
    search.searchParams.set('page', '1');
    const response = await services.request({ url: search, expectedContent: 'json', headers, stateScope: { kind: 'source', key: source.id } }, signal);
    const titles = (response.json() as FlyflixCatalogResponse).results;
    if (!Array.isArray(titles)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Flyflix catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (!titles.some(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || !result.release_date || Number(result.release_date.slice(0, 4)) === media.year))) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      let season: ExtractionResponse;
      try {
        season = await services.request({ url: new URL(`https://api.themoviedb.org/3/tv/${media.tmdbId}/season/${media.season}?language=en-US`), expectedContent: 'json', headers, stateScope: { kind: 'source', key: source.id } }, signal);
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
        throw error;
      }
      const catalog = season.json() as FlyflixCatalogResponse;
      if (!Array.isArray(catalog.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Flyflix season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: season.status, bodyCaptured: false, parserPath: 'episodes' } } };
      if (catalog.season_number !== media.season || !catalog.episodes.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
    }
    const results = await Promise.allSettled(players.map(player => player.host.discover(media, player.url, source.id, this.id, services, signal)));
    const streams = results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []);
    if (streams.length) return { type: 'streams', streams };
    const failure = results.find(result => result.status === 'fulfilled' && result.value.type === 'failure');
    if (failure?.status === 'fulfilled') return failure.value;
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected') throw rejected.reason;
    return { type: 'empty', reason: 'no-streams' };
  }
}
