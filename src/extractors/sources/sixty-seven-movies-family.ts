import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { type CinezoHostArchitecture, CinezoPlayerHostArchitecture } from '../hosts/cinezo-host-architecture';
import { VidloveApiHostArchitecture, type VidloveHostArchitecture } from '../hosts/vidlove-host-architecture';

interface SixtySevenMoviesSearchResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string }[];
}

export class SixtySevenMoviesFamily implements SourceFamily {
  public readonly id = 'sixty-seven-movies';

  public constructor(private readonly host: VidloveHostArchitecture = new VidloveApiHostArchitecture(), private readonly cinezo: CinezoHostArchitecture = new CinezoPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /(?:<title>|application-name[^>]+content=)[^<>"]*67movies/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'sixty-seven-movies-brand' });
    if (snapshot.htmlSample && /67movies\.[a-z]+[^<]{0,160}(?:movies|tv shows)|(?:movies|tv shows)[^<]{0,160}67movies\.[a-z]+/i.test(snapshot.htmlSample)) evidence.push({ type: 'route-shape', value: 'sixty-seven-movies-catalog' });
    if (snapshot.assetPaths.some(path => /\/_next\/static\/chunks\/(?:app\/)?(?:page|layout)-[a-z0-9]+\.js$/i.test(path))) evidence.push({ type: 'asset-path', value: 'sixty-seven-movies-next-client' });
    if (evidence.length < 3) return null;
    return { familyId: this.id, confidence: 1, evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/api/semantic-search', `https://${source.canonicalDomain}/`);
    search.searchParams.set('q', media.title);
    const response = await services.request({ url: search, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as SixtySevenMoviesSearchResponse).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: '67Movies search response did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || !(result.release_date ?? result.first_air_date) || Number((result.release_date ?? result.first_air_date)?.slice(0, 4)) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    const watchUrl = new URL(`/watch/${media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`}`, search);
    const watch = await services.request({ url: watchUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(watch.text());
    const assets = $('script[src]').map((_index, element) => $(element).attr('src')).get().filter(path => /^\/_next\/static\/chunks\/app\/watch\/.+\/page-[a-z0-9]+\.js(?:\?|$)/i.test(path));
    for (const asset of assets) {
      const script = await services.request({ url: new URL(asset, watch.finalUrl), expectedContent: 'text', referrer: watch.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
      const client = script.text();
      const players = [...client.matchAll(/\{key:"(vidlove|cinezo)",label:"[^"\n]+"/g)].flatMap((server) => {
        const paths = server[1] === 'vidlove'
          ? client.match(/case"vidlove":default:return"tv"===[^?]+\?"(https:\/\/[^"/]+\/embed\/tv\/)"[^;]+?:"(https:\/\/[^"/]+\/embed\/movie\/)"/)
          : client.match(/case"cinezo":return"tv"===[^?]+\?"(https:\/\/[^"/]+\/tv\/)"[^;]+?:"(https:\/\/[^"/]+\/movie\/)"/);
        return paths ? [{ host: server[1] === 'vidlove' ? this.host : this.cinezo, url: new URL(`${media.tmdbId}${media.type === 'episode' ? `/${media.season}/${media.episode}` : ''}`, paths[media.type === 'movie' ? 2 : 1]) }] : [];
      });
      if (!players.length) continue;
      if (media.type === 'episode') {
        const key = client.match(/\b(?:let|const)\s+[\w$]+="([a-f0-9]{32})"/)?.[1];
        if (!key || !client.includes('https://api.themoviedb.org/3/tv/')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: '67Movies watch client no longer exposes its season catalog', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'watch-season-catalog' } } };
        const seasonUrl = new URL(`https://api.themoviedb.org/3/tv/${media.tmdbId}/season/${media.season}`);
        seasonUrl.searchParams.set('api_key', key);
        let season: ExtractionResponse;
        try {
          season = await services.request({ url: seasonUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
        } catch (error) {
          if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
          throw error;
        }
        const catalog = season.json() as { season_number?: number; episodes?: readonly { episode_number?: number }[] };
        if (!Array.isArray(catalog.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: '67Movies season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'episodes' } } };
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
    return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: '67Movies watch client no longer configures a supported player', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'watch-player-assets' } } };
  }
}
