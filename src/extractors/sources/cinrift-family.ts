import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { VidriftApiHostArchitecture, type VidriftHostArchitecture } from '../hosts/vidrift-host-architecture';

interface CinriftSearchResponse {
  results?: readonly { id?: number; title?: string; year?: string; mediaType?: string }[];
}

interface CinriftSeasonResponse {
  episodes?: readonly { episode_number?: number }[];
}

export class CinriftFamily implements SourceFamily {
  public readonly id = 'cinrift';

  public constructor(private readonly host: VidriftHostArchitecture = new VidriftApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('link[rel="preconnect"][href]').toArray().some(element => /^https:\/\/embed\.vidrift\.[a-z]+$/.test($(element).attr('href') ?? ''))) evidence.push({ type: 'dom-shape', fingerprint: 'vidrift-player-preconnect' });
    if ($('script:not([src])').toArray().some(element => /localStorage\.getItem\("cinrift_[a-z_]+"\)/.test($(element).text()))) evidence.push({ type: 'script-signature', fingerprint: 'cinrift-client' });
    const cards = $('[data-media-card="true"][data-navigation-href]').toArray().map(element => $(element).attr('data-navigation-href') ?? '');
    if (cards.some(path => /^\/movie\/\d+$/.test(path)) && cards.some(path => /^\/tv\/\d+$/.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/{tmdbId}' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/api/search', `https://${source.canonicalDomain}/`);
    search.searchParams.set('v', '3');
    search.searchParams.set('q', media.title);
    const response = await services.request({ url: search, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as CinriftSearchResponse).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinrift catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && result.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.mediaType === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || Number(result.year) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      const seasonResponse = await services.request({ url: new URL(`/api/tv/${media.tmdbId}/season/${media.season}`, search), expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
      const episodes = (seasonResponse.json() as CinriftSeasonResponse).episodes;
      if (!Array.isArray(episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinrift season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: seasonResponse.status, bodyCaptured: false, parserPath: 'episodes' } } };
      if (!episodes.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
    }
    const watchUrl = new URL(`/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}/watch`, search);
    if (media.type === 'episode') {
      watchUrl.searchParams.set('season', String(media.season));
      watchUrl.searchParams.set('episode', String(media.episode));
    }
    const watch = await services.request({ url: watchUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const page = cheerio.load(watch.text());
    const player = page('link[rel="preconnect"][href]').toArray().map(element => page(element).attr('href') ?? '').find(href => /^https:\/\/embed\.vidrift\.[a-z]+$/.test(href));
    if (!player) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'Cinrift watch page no longer declares its Vidrift player', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: watch.status, bodyCaptured: false, parserPath: 'player-preconnect' } } };
    const grant = await services.request({ url: new URL('/api/playback-token', search), method: 'POST', headers: { 'content-type': 'application/json', 'origin': search.origin }, body: JSON.stringify({ tmdbId: media.tmdbId, type: media.type === 'movie' ? 'movie' : 'tv', season: media.season ?? 1, episode: media.episode ?? 1 }), expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const token = (grant.json() as { token?: string }).token;
    if (typeof token !== 'string' || !token) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinrift playback grant did not contain a token', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: grant.status, bodyCaptured: false, parserPath: 'token' } } };
    return this.host.discover(media, new URL(player), token, source.id, this.id, services, signal);
  }
}
