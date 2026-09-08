import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { VidsrcMeApiHostArchitecture, type VidsrcMeHostArchitecture } from '../hosts/vidsrcme-host-architecture';

interface SoaperPlayerConfiguration { type?: string; tmdb?: number; season?: number; episode?: number }

export class SoaperFamily implements SourceFamily {
  public readonly id = 'soaper';

  public constructor(private readonly host: VidsrcMeHostArchitecture = new VidsrcMeApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('main.landing .brand[href="/home"] img[src="/logo.png"]').length) evidence.push({ type: 'dom-shape', fingerprint: 'soaper-landing-brand' });
    if ($('form[action="/search"] input#landing-search[name="key"]').length) evidence.push({ type: 'api-shape', fingerprint: 'soaper-catalog-search' });
    if (['/home', '/movies', '/tv'].every(path => $('.actions a.home-link').toArray().some(element => $(element).attr('href') === path))) evidence.push({ type: 'route-shape', value: 'soaper-catalog-navigation' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/search', `https://${source.canonicalDomain}`);
    search.searchParams.set('key', media.title);
    const response = await services.request({ url: search, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(response.text());
    if (!$('[aria-labelledby="movie-results-heading"], [aria-labelledby="tv-results-heading"]').length && !$('.alert.alert-warning').text().startsWith('No matches found for')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Soaper catalog search no longer exposes its result sections', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'catalog-results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const candidates = $(`[aria-labelledby="${media.type === 'movie' ? 'movie' : 'tv'}-results-heading"] article`).map((_index, element) => {
      const anchor = $(element).find('.poster-title a').first();
      return { title: anchor.text().toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(), href: anchor.attr('href'), year: Number($(element).find('.img-tip').text().slice(0, 4)) };
    }).get();
    const match = candidates.find(candidate => candidate.title === expectedTitle && candidate.href?.startsWith(media.type === 'movie' ? '/movie/' : '/tv/') && (media.type !== 'movie' || media.year === undefined || candidate.year === media.year));
    if (!match?.href) return { type: 'empty', reason: 'not-found' };
    let page = await services.request({ url: new URL(match.href, response.finalUrl), expectedContent: 'html', referrer: response.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    if (media.type === 'episode') {
      const series = cheerio.load(page.text());
      const episode = series('.legacy-season-list a[data-episode-id][href]').toArray().map(element => series(element).attr('href')).find(href => href?.startsWith(`${match.href}/s${media.season}e${media.episode}-`));
      if (!episode) return { type: 'empty', reason: 'not-found' };
      page = await services.request({ url: new URL(episode, page.finalUrl), expectedContent: 'html', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    }
    const content = cheerio.load(page.text());
    const embed = content('iframe.stream-embed-frame').attr('src');
    if (!embed?.startsWith(media.type === 'movie' ? '/embed/movie/' : '/embed/tv/')) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'Soaper catalog entry no longer exposes its player', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: page.status, bodyCaptured: false, parserPath: 'stream-embed-frame' } } };
    const player = await services.request({ url: new URL(embed, page.finalUrl), expectedContent: 'html', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const html = player.text();
    const configuration = html.match(/var resolverConfig\s*=\s*(\{[^\n]+?\})\s*\|\|\s*\{\}/)?.[1];
    if (!configuration || !html.includes('https://vidsrcme.ru/embed/movie') || !html.includes('https://vidsrcme.ru/embed/tv')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Soaper player no longer exposes its VidsrcMe fallback configuration', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: player.status, bodyCaptured: false, parserPath: 'resolverConfig' } } };
    const configured = JSON.parse(configuration) as SoaperPlayerConfiguration;
    if (configured.tmdb !== media.tmdbId || configured.type !== (media.type === 'movie' ? 'movie' : 'tv') || (media.type === 'episode' && (configured.season !== media.season || configured.episode !== media.episode))) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Soaper player does not match the requested media', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'resolverConfig' } } };
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
