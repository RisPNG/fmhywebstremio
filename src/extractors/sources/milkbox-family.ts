import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { VidsparkApiHostArchitecture, type VidsparkHostArchitecture } from '../hosts/vidspark-host-architecture';

interface MilkBoxCatalogResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string }[];
  season_number?: number;
  episodes?: readonly { episode_number?: number }[];
}

export class MilkBoxFamily implements SourceFamily {
  public readonly id = 'milkbox';

  public constructor(private readonly host: VidsparkHostArchitecture = new VidsparkApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^MILKBOX$/i.test($('title').text().trim())) evidence.push({ type: 'script-signature', fingerprint: 'milkbox-brand' });
    if ($('#searchInput').length && $('#playerModal').length && $('#serverSelect option[value="vidspark"]').length) evidence.push({ type: 'dom-shape', fingerprint: 'milkbox-catalog-player' });
    if ($('script[src]').toArray().some(element => /^\/app\.js(?:\?|$)/.test($(element).attr('src') ?? ''))) evidence.push({ type: 'asset-path', value: 'milkbox-app-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const page = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(page.text());
    const asset = $('script[src]').toArray().map(element => $(element).attr('src')).find(path => /^\/app\.js(?:\?|$)/.test(path ?? ''));
    if (!asset || !$('#serverSelect option[value="vidspark"]').length) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'MilkBox no longer exposes its catalog client and VidSpark server', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'catalog-client' } } };
    const script = await services.request({ url: new URL(asset, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const client = script.text();
    const catalogPath = client.match(/const TMDB_BASE = new URL\('([^']+)', document\.baseURI\)\.pathname/)?.[1];
    const player = client.match(/function vidsparkIframe\([^)]*\)\s*\{[\s\S]*?if \(type === 'tv'\) url = `(https:\/\/[^`]+\/tv\/)\$\{encodeURIComponent\(tmdbId\)\}\/\$\{encodeURIComponent\(season \|\| 1\)\}\/\$\{encodeURIComponent\(episode \|\| 1\)\}`;\s*else url = `(https:\/\/[^`]+\/movie\/)\$\{encodeURIComponent\(tmdbId\)\}`;/);
    if (!catalogPath || !player || !client.includes('tmdbJson(`/search/multi?query=') || !client.includes('tmdbJson(`/tv/${encodeURIComponent(tmdbId)}/season/${sn}`)')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'MilkBox client no longer declares its search, season catalog, and VidSpark player routes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'catalog-player-routes' } } };
    const catalog = new URL(catalogPath, page.finalUrl);
    const search = new URL('search/multi', catalog);
    search.searchParams.set('query', media.title);
    search.searchParams.set('page', '1');
    search.searchParams.set('language', 'en-US');
    const response = await services.request({ url: search, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as MilkBoxCatalogResponse).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'MilkBox catalog search did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => result.id === media.tmdbId
      && (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || !result.release_date || Number(result.release_date.slice(0, 4)) === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      let season: ExtractionResponse;
      try {
        const seasonUrl = new URL(`tv/${media.tmdbId}/season/${media.season}`, catalog);
        seasonUrl.searchParams.set('language', 'en-US');
        season = await services.request({ url: seasonUrl, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
        throw error;
      }
      const details = season.json() as MilkBoxCatalogResponse;
      if (!Array.isArray(details.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'MilkBox season catalog did not contain episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: season.status, bodyCaptured: false, parserPath: 'episodes' } } };
      if (details.season_number !== media.season || !details.episodes.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
    }
    return this.host.discover(media, new URL(`${media.tmdbId}${media.type === 'episode' ? `/${media.season}/${media.episode}` : ''}`, player[media.type === 'movie' ? 2 : 1]), source.id, this.id, services, signal);
  }
}
