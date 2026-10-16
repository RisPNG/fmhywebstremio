import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

interface CinegoSearchResponse {
  data?: readonly { t?: string; s?: string; d?: string; y?: number }[];
}

export class CinegoFamily implements SourceFamily {
  public readonly id = 'cinego';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /(?:^|["'])\/js\/app\.min(?:\.[a-z0-9]+)?\.js/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinego-client' });
    if (snapshot.htmlSample && /(?:\/movie\/|\/tv-serie\/)/i.test(snapshot.htmlSample)) evidence.push({ type: 'route-shape', value: 'cinego-catalog-routes' });
    if (snapshot.htmlSample && /(?:plyURL|aHR0cHM6Ly9wbG95YW4ubWU=)/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinego-player-grant' });
    if (evidence.length < 2 || !evidence.some(value => value.type === 'script-signature' && value.fingerprint === 'cinego-player-grant')) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/searching', `https://${source.canonicalDomain}/`);
    search.searchParams.set('q', media.title);
    search.searchParams.set('limit', '24');
    search.searchParams.set('offset', '0');
    let response: Awaited<ReturnType<RequestServices['request']>>;
    try {
      response = await services.request({ url: search, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      const failure = error && typeof error === 'object' && 'failure' in error ? (error as { failure?: { code?: string } }).failure : undefined;
      if (failure?.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const results = (response.json() as CinegoSearchResponse).data;
    if (!Array.isArray(results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'CineGo search response did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, ...(response.headers['content-type'] && { contentType: response.headers['content-type'] }), finalUrl: response.finalUrl.toString(), bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'data' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const expectedCatalogTitle = media.type === 'episode' ? `${expectedTitle} season ${media.season}` : expectedTitle;
    const match = results.find(result => result.t?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedCatalogTitle
      && (media.type === 'movie' ? result.d === 'm' : result.d !== 'm')
      && (media.type !== 'movie' || media.year === undefined || result.y === undefined || result.y === media.year));
    if (!match) return { type: 'empty', reason: 'not-found' };
    const home = await services.request({ url: new URL('/', search), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const configured = home.text().match(/\bplyURL\s*=\s*["']([^"']+)["']/)?.[1];
    if (!configured) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'CineGo no longer declares its playback host', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'plyURL' } } };
    const player = new URL(Buffer.from(configured, 'base64').toString('utf8'));
    return { type: 'failure', failure: { code: 'UNKNOWN_HOST', message: 'CineGo playback requires an unsupported player-grant architecture', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, targetHost: player.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'plyURL' } } };
  }
}
