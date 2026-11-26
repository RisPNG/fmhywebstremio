import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';

interface CatalogEntry {
  title?: string;
  name?: string;
  release_date?: string;
  episodes?: readonly { episode_number?: number }[];
}

interface ProviderResponse {
  found?: boolean;
  url?: string;
  sources?: { [Server in 'Vidbox' | 'Vixsrc' | 'Dizipal']?: { url?: string; type?: string } };
  releases?: readonly { master?: string }[];
}

const catalogApi = 'https://db.hls.lol/3';
const providers = [
  { id: 'vidbox-api', url: (_media: MediaIdentity, query: URLSearchParams) => new URL(`https://stream.hls.lol/vidbox?${query}`), playlist: (payload: ProviderResponse) => payload.sources?.Vidbox?.type === 'hls' ? payload.sources.Vidbox.url : undefined },
  { id: 'play4u-api', url: (_media: MediaIdentity, query: URLSearchParams) => new URL(`https://stream.hls.lol/play4u?${query}`), playlist: (payload: ProviderResponse) => payload.url },
  { id: 'q62-api', url: (_media: MediaIdentity, query: URLSearchParams) => new URL(`https://stream.hls.lol/q62?${query}`), playlist: (payload: ProviderResponse) => payload.releases?.[0]?.master },
  { id: 'shegu-api', url: (media: MediaIdentity) => new URL(media.type === 'movie' ? `/resolve/movie/${media.tmdbId}` : `/resolve/tv/${media.season}/${media.episode}/${media.tmdbId}`, 'https://shegu.hls.lol'), playlist: (payload: ProviderResponse) => payload.found ? payload.url : undefined },
  { id: 'vixsrc-api', url: (_media: MediaIdentity, query: URLSearchParams) => new URL(`https://it.hls.lol/resolve?${query}`), playlist: (payload: ProviderResponse) => payload.sources?.Vixsrc?.type === 'hls' ? payload.sources.Vixsrc.url : undefined },
  { id: 'dizipal-api', url: (media: MediaIdentity, query: URLSearchParams) => new URL(`https://pal.hls.lol/resolve?${query}&${new URLSearchParams({ title: media.title ?? '', ...(media.year !== undefined && { year: String(media.year) }) })}`), playlist: (payload: ProviderResponse) => payload.sources?.Dizipal?.type === 'hls' ? payload.sources.Dizipal.url : undefined },
] as const;

export class AtlanticFamily implements SourceFamily {
  public readonly id = 'atlantic';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('meta[property="og:site_name"]').attr('content') === 'Atlantic') evidence.push({ type: 'script-signature', fingerprint: 'atlantic-brand' });
    if ($('title').text().startsWith('Atlantic')) evidence.push({ type: 'dom-shape', fingerprint: 'atlantic-title' });
    if ($('#root').length && $('script[type="module"][src^="/assets/index-"]').length) evidence.push({ type: 'asset-path', value: 'atlantic-vite-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const origin = new URL(`https://${source.canonicalDomain}/`);
    const headers = { origin: origin.origin, referer: origin.href };
    const stateScope = { kind: 'source', key: source.id } as const;
    const normalize = (title: string | undefined) => title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const catalog = async (path: string): Promise<CatalogEntry | undefined> => {
      try {
        return (await services.request({ url: new URL(`${catalogApi}${path}?language=en`), expectedContent: 'json', headers, referrer: origin, stateScope }, signal)).json() as CatalogEntry;
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return undefined;
        throw error;
      }
    };
    const entry = await catalog(`/${media.type === 'movie' ? 'movie' : 'tv'}/${media.tmdbId}`);
    if (normalize(entry?.title ?? entry?.name) !== normalize(media.title) || (media.type === 'movie' && media.year !== undefined && entry?.release_date?.slice(0, 4) !== String(media.year))) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode' && !(await catalog(`/tv/${media.tmdbId}/season/${media.season}`))?.episodes?.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
    const query = new URLSearchParams({ tmdbId: String(media.tmdbId), type: media.type === 'movie' ? 'movie' : 'tv', ...(media.type === 'episode' && { seasonId: String(media.season), episodeId: String(media.episode) }) });
    const results = await Promise.allSettled(providers.map(async (provider): Promise<ExtractionResult> => {
      let payload: ProviderResponse;
      try {
        payload = (await services.request({ url: provider.url(media, query), expectedContent: 'json', headers, referrer: origin, timeoutMs: 15000, stateScope }, signal)).json() as ProviderResponse;
      } catch (error) {
        if (error instanceof TransportFailure && (error.failure.code === 'HTTP_NOT_FOUND' || error.failure.code === 'HTTP_SERVER_ERROR')) return { type: 'empty', reason: 'no-streams' };
        throw error;
      }
      const playlist = provider.playlist(payload);
      if (!playlist) return { type: 'empty', reason: 'no-streams' };
      const playlistUrl = new URL(playlist);
      if (playlistUrl.protocol !== 'https:') return { type: 'empty', reason: 'no-streams' };
      const stream: StreamCandidate = { url: playlistUrl, protocol: 'hls', delivery: 'relayed', headers, hostExtractor: provider.id, sourceId: source.id, sourceExtractor: this.id, discoveredAt: new Date() };
      return { type: 'streams', streams: [stream] };
    }));
    const streams = results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []);
    if (streams.length) return { type: 'streams', streams };
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected' && results.every(result => result.status === 'rejected')) throw rejected.reason;
    return { type: 'empty', reason: 'no-streams' };
  }
}
