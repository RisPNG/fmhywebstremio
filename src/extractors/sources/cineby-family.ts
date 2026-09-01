import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';

export class CinebyFamily implements SourceFamily {
  public readonly id = 'cineby';

  public constructor(private readonly host: SpeedracelightHostArchitecture = new SpeedracelightApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /<title>[^<]*Cineby|(?:og:site_name|application-name)[^>]+content="Cineby TV"/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinebytv-brand' });
    if (snapshot.routeHints.some(path => /^\/(?:movie|tv)\/\d+/i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/{tmdbId}' });
    if (snapshot.assetPaths.some(path => /\/_next\/static\/(?:chunks|css)\//i.test(path))) evidence.push({ type: 'asset-path', value: 'cinebytv-next-client' });
    if (!evidence.some(item => item.type === 'script-signature' && item.fingerprint === 'cinebytv-brand') || evidence.length < 2) return null;
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
    const catalogTitle = html.match(new RegExp(`<title>Watch ([^<]+) Online Free \\| Cineby TV</title>`, 'i'))?.[1]?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const catalogId = html.includes(`\\"id\\":${media.tmdbId}`) ? media.tmdbId : 0;
    const catalogYear = Number(html.match(media.type === 'movie' ? /\\"release_date\\":\\"(\d{4})-/ : /\\"first_air_date\\":\\"(\d{4})-/)?.[1]);
    if (catalogId !== media.tmdbId || catalogTitle !== normalizedTitle || (media.year !== undefined && catalogYear !== media.year)) return { type: 'empty', reason: 'not-found' };
    return this.host.discover(media, source.id, services, signal);
  }
}
