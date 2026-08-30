import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { VidsrcMeApiHostArchitecture, type VidsrcMeHostArchitecture } from '../hosts/vidsrcme-host-architecture';

interface SixtySevenMoviesSearchResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string; first_air_date?: string }[];
}

export class SixtySevenMoviesFamily implements SourceFamily {
  public readonly id = 'sixty-seven-movies';

  public constructor(private readonly host: VidsrcMeHostArchitecture = new VidsrcMeApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /(?:<title>|application-name[^>]+content=)[^<>"]*67movies/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'sixty-seven-movies-brand' });
    if (snapshot.htmlSample && /67movies\.net[^<]{0,160}(?:movies|tv shows)|(?:movies|tv shows)[^<]{0,160}67movies\.net/i.test(snapshot.htmlSample)) evidence.push({ type: 'route-shape', value: 'sixty-seven-movies-catalog' });
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
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
