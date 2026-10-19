import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';

interface KkPhimEpisode { name?: string; slug: string; filename: string; link_embed: string; link_m3u8?: string }
interface KkPhimResponse {
  status?: boolean;
  movie?: { tmdb?: { id?: string; type?: string; season?: number | null } };
  episodes?: readonly { server_name: string; server_data?: readonly KkPhimEpisode[] }[];
}

export class KkPhimFamily implements SourceFamily {
  public readonly id = 'kkphim';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/\bKKPhim\b/i.test($('title').text()) && $('img[alt="KKPhim"]').length) evidence.push({ type: 'script-signature', fingerprint: 'kkphim-brand' });
    if ($('a[href="/api-document"]').length && $('a[href^="/phim/"]').length) evidence.push({ type: 'route-shape', value: 'kkphim-api-catalog' });
    if ($('script[src]').toArray().some(element => /^\/js\/main\.js(?:\?|$)/.test($(element).attr('src') ?? ''))) evidence.push({ type: 'asset-path', value: 'kkphim-main-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    let response: ExtractionResponse;
    try {
      response = await services.request({ url: new URL(`https://phimapi.com/tmdb/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`), expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const catalog = response.json() as KkPhimResponse;
    if (catalog.status === false) return { type: 'empty', reason: 'not-found' };
    if (catalog.status !== true || !catalog.movie?.tmdb || !Array.isArray(catalog.episodes) || catalog.episodes.some(server => !Array.isArray(server.server_data))) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'KKPhim lookup no longer contains its media identity and episode servers', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'movie.tmdb/episodes.server_data' } } };
    const identity = catalog.movie.tmdb;
    if (Number(identity.id) !== media.tmdbId || identity.type !== (media.type === 'movie' ? 'movie' : 'tv') || (media.type === 'episode' && identity.season !== media.season)) return { type: 'empty', reason: 'not-found' };
    const streams: StreamCandidate[] = catalog.episodes.flatMap(server => (server.server_data ?? []).flatMap((episode: KkPhimEpisode) => {
      const number = episode.name?.match(/^(?:Tập\s*)?0*(\d+)$/iu)?.[1];
      if (!episode.link_m3u8 || (media.type === 'episode' && Number(number) !== media.episode)) return [];
      const player = new URL(episode.link_embed);
      return [{ url: new URL(episode.link_m3u8), protocol: 'hls', delivery: 'relayed', headers: { origin: player.origin, referer: new URL('/', player).href }, label: `${server.server_name} · ${episode.filename}`, sourceId: source.id, sourceExtractor: this.id, hostExtractor: 'phimapi', discoveredAt: new Date() }];
    }));
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
