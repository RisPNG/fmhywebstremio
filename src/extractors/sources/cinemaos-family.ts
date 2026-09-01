import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { SpeedracelightApiHostArchitecture, type SpeedracelightHostArchitecture } from '../hosts/speedracelight-host-architecture';

export class CinemaOsFamily implements SourceFamily {
  public readonly id = 'cinemaos';

  public constructor(private readonly host: SpeedracelightHostArchitecture = new SpeedracelightApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /<title>[^<]*Cinemaos|(?:og:site_name|application-name)[^>]+content="Cinemaos"/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinemaos-brand' });
    if (snapshot.routeHints.some(path => /^\/(?:movie|tv)\/watch\/\d+/i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tv/watch/{tmdbId}' });
    if (snapshot.assetPaths.some(path => /\/_next\/static\/(?:chunks|css)\//i.test(path))) evidence.push({ type: 'asset-path', value: 'cinemaos-next-client' });
    if (!evidence.some(item => item.type === 'script-signature' && item.fingerprint === 'cinemaos-brand') || evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const catalogUrl = new URL(`/watch/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`, `https://${source.canonicalDomain}/`);
    if (media.type === 'episode') {
      catalogUrl.searchParams.set('season', String(media.season));
      catalogUrl.searchParams.set('episode', String(media.episode));
    }
    let response: ExtractionResponse;
    try {
      response = await services.request({ url: catalogUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const html = response.text();
    const normalizedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const pageTitle = html.match(media.type === 'movie' ? /<title>Watch ([^(<]+?)(?: \(\d{4}\))? - Cinemaos<\/title>/i : new RegExp(`<title>([^<]+?) - S${media.season}E${media.episode} \\| Watch - Cinemaos</title>`, 'i'))?.[1]?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const catalogEntry = [...html.matchAll(media.type === 'movie' ? /\\"title\\":\\"([^"\\]+)\\",\\"original_title\\":\\"[^"\\]*\\",\\"release_date\\":\\"(\d{4})-/gi : /\\"name\\":\\"([^"\\]+)\\",\\"original_name\\":\\"[^"\\]*\\",\\"first_air_date\\":\\"(\d{4})-/gi)].find(match => match[1]?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === normalizedTitle);
    const catalogId = html.includes(`\\"id\\":${media.tmdbId}`) ? media.tmdbId : 0;
    const catalogYear = Number(catalogEntry?.[2]);
    if (catalogId !== media.tmdbId || pageTitle !== normalizedTitle || !catalogEntry || (media.year !== undefined && catalogYear !== media.year)) return { type: 'empty', reason: 'not-found' };
    return this.host.discover(media, source.id, this.id, services, signal);
  }
}
