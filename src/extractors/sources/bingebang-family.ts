import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { type BingeBangHostArchitecture, BingeBangPlayerHostArchitecture } from '../hosts/bingebang-host-architecture';

interface BingeBangSearchResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; year?: number; number_of_seasons?: number; play_url?: string }[];
}

export class BingeBangFamily implements SourceFamily {
  public readonly id = 'bingebang';

  public constructor(private readonly host: BingeBangHostArchitecture = new BingeBangPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const html = snapshot.htmlSample ?? '';
    const evidence: FamilyEvidence[] = [];
    if (/\/assets\/js\/app\.bundle\.min\.js/i.test(html) && /localStorage\.getItem\("bb/i.test(html)) evidence.push({ type: 'script-signature', fingerprint: 'bingebang-client' });
    if (/"urlTemplate":"[^"]*\/explore\?q=\{search_term_string\}"/i.test(html)) evidence.push({ type: 'api-shape', fingerprint: 'bingebang-explore-search' });
    if (snapshot.routeHints.some(path => /^\/movie\/watch\/[^/]+$/i.test(path)) && snapshot.routeHints.some(path => /^\/tv\//i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/watch/{slug}' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const catalogUrl = new URL('/api/search/multi', `https://${source.canonicalDomain}/`);
    catalogUrl.searchParams.set('query', media.title);
    const response = await services.request({ url: catalogUrl, expectedContent: 'json', referrer: new URL(`https://${source.canonicalDomain}/`), stateScope: { kind: 'source', key: source.id } }, signal);
    const results = (response.json() as BingeBangSearchResponse).results;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'BingeBang search response did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = results.find(result => (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && result.play_url
      && (media.type === 'movie'
        ? media.year === undefined || result.year === media.year
        : typeof result.number_of_seasons === 'number' && media.season !== undefined && media.season > 0 && media.season <= result.number_of_seasons));
    if (!match?.play_url) return { type: 'empty', reason: 'not-found' };
    return this.host.discover(new URL(match.play_url, catalogUrl), media, source.id, this.id, services, signal);
  }
}
