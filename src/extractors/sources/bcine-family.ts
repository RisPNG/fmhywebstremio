import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { OneEmbedApiHostArchitecture, type OneEmbedHostArchitecture } from '../hosts/oneembed-host-architecture';

export class BcineFamily implements SourceFamily {
  public readonly id = 'bcine';

  public constructor(private readonly host: OneEmbedHostArchitecture = new OneEmbedApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /<title>[^<]*bCine|application-name[^>]+content="bCine"/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'bcine-brand' });
    if (snapshot.routeHints.some(path => /^\/(?:movie|tv)\/\d+/i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/{tmdbId}' });
    if (snapshot.assetPaths.some(path => /\/bcine(?:icon)?\.png/i.test(path))) evidence.push({ type: 'asset-path', value: 'bcine-next-client' });
    if (!evidence.some(item => item.type === 'script-signature' && item.fingerprint === 'bcine-brand') || evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const catalogUrl = new URL(`/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`, `https://${source.canonicalDomain}/`);
    let response: ExtractionResponse;
    try {
      response = await services.request({ url: catalogUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const html = response.text();
    const normalizedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const catalogTitle = [...html.matchAll(new RegExp(`\\\\"${media.type === 'movie' ? 'title' : 'name'}\\\\":\\\\"([^"\\\\]+)`, 'gi'))].map(match => match[1]?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).find(title => title === normalizedTitle);
    const catalogId = html.includes(`\\"id\\":${media.tmdbId}`) ? media.tmdbId : 0;
    const catalogYear = Number(html.match(media.type === 'movie' ? /\\"release_date\\":\\"(\d{4})-/ : /\\"first_air_date\\":\\"(\d{4})-/)?.[1]);
    if (catalogId !== media.tmdbId || catalogTitle !== normalizedTitle || (media.type === 'movie' && media.year !== undefined && catalogYear !== media.year)) return { type: 'empty', reason: 'not-found' };
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
