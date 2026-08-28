import type { MediaIdentity, MediaRequest, RequestServices } from './models';
import type { MediaResolver } from './runtime-stream-engine';

interface TmdbTitle { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string }
interface TmdbFindResponse { movie_results?: TmdbTitle[]; tv_results?: TmdbTitle[] }

export class TmdbMediaResolver implements MediaResolver {
  public constructor(private readonly services: RequestServices, private readonly accessToken: string) {}

  public async resolve(request: MediaRequest, signal: AbortSignal): Promise<MediaIdentity> {
    if (request.title) return { ...request, canonicalId: request.tmdbId ? `tmdb:${request.tmdbId}` : request.imdbId ?? `title:${request.title}`, title: request.title };
    const headers = { authorization: `Bearer ${this.accessToken}` };
    let media: TmdbTitle | undefined;
    if (request.tmdbId) {
      const response = await this.services.request({ url: new URL(`https://api.themoviedb.org/3/${request.type === 'movie' ? 'movie' : 'tv'}/${request.tmdbId}`), headers, expectedContent: 'json' }, signal);
      media = response.json() as TmdbTitle;
    } else if (request.imdbId) {
      const url = new URL(`https://api.themoviedb.org/3/find/${request.imdbId}`);
      url.searchParams.set('external_source', 'imdb_id');
      const response = await this.services.request({ url, headers, expectedContent: 'json' }, signal);
      const found = response.json() as TmdbFindResponse;
      media = request.type === 'movie' ? found.movie_results?.[0] : found.tv_results?.[0];
    }
    const title = media?.title ?? media?.name;
    if (!media || !title) throw new Error(`Media metadata was not found for ${request.tmdbId ? `TMDB ${request.tmdbId}` : request.imdbId ?? 'the request'}`);
    const date = media.release_date ?? media.first_air_date;
    return { ...request, canonicalId: `tmdb:${media.id}`, tmdbId: media.id, title, ...(date && { year: Number(date.slice(0, 4)) }) };
  }
}
