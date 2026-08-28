import type { MediaIdentity, MediaRequest, RequestServices } from './models';
import type { MediaResolver } from './runtime-stream-engine';

interface TmdbTitle { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string }
interface CinemetaResponse { meta?: { name?: string; releaseInfo?: string; moviedb_id?: number } }

export class StremioMediaResolver implements MediaResolver {
  public constructor(private readonly services: RequestServices, private readonly tmdbAccessToken: string) {}

  public async resolve(request: MediaRequest, signal: AbortSignal): Promise<MediaIdentity> {
    if (request.title) return { ...request, canonicalId: request.tmdbId ? `tmdb:${request.tmdbId}` : request.imdbId ?? `title:${request.title}`, title: request.title };
    if (request.imdbId) {
      const kind = request.type === 'movie' ? 'movie' : 'series';
      const response = await this.services.request({ url: new URL(`https://v3-cinemeta.strem.io/meta/${kind}/${request.imdbId}.json`), expectedContent: 'json' }, signal);
      const meta = (response.json() as CinemetaResponse).meta;
      if (!meta?.name || !meta.moviedb_id) throw new Error(`Media metadata was not found for ${request.imdbId}`);
      const year = meta.releaseInfo?.match(/^\d{4}/)?.[0];
      return { ...request, canonicalId: `tmdb:${meta.moviedb_id}`, tmdbId: meta.moviedb_id, title: meta.name, ...(year && { year: Number(year) }) };
    }
    if (!request.tmdbId) throw new Error('Media metadata was not found for the request');
    if (!this.tmdbAccessToken) return { ...request, canonicalId: `tmdb:${request.tmdbId}`, title: '' };
    const response = await this.services.request({ url: new URL(`https://api.themoviedb.org/3/${request.type === 'movie' ? 'movie' : 'tv'}/${request.tmdbId}`), headers: { authorization: `Bearer ${this.tmdbAccessToken}` }, expectedContent: 'json' }, signal);
    const media = response.json() as TmdbTitle;
    const title = media.title ?? media.name;
    if (!title) throw new Error(`Media metadata was not found for TMDB ${request.tmdbId}`);
    const date = media.release_date ?? media.first_air_date;
    return { ...request, canonicalId: `tmdb:${media.id}`, tmdbId: media.id, title, ...(date && { year: Number(date.slice(0, 4)) }) };
  }
}
