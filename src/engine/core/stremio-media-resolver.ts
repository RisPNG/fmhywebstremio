import type { MediaIdentity, MediaRequest, RequestServices } from './models';
import type { MediaResolver } from './runtime-stream-engine';

interface TmdbTitle { id: number; title?: string; name?: string; release_date?: string; first_air_date?: string }
interface CinemetaResponse { meta?: { name?: string; releaseInfo?: string; moviedb_id?: number } }

export class StremioMediaResolver implements MediaResolver {
  public constructor(private readonly services: RequestServices, private readonly tmdbAccessToken: string) {}

  public async resolve(request: MediaRequest, signal: AbortSignal): Promise<MediaIdentity> {
    if (request.title) return { ...request, canonicalId: request.tmdbId ? `tmdb:${request.tmdbId}` : request.imdbId ?? `title:${request.title}`, title: request.title };
    let identity = request;
    if (request.imdbId) {
      const kind = request.type === 'movie' ? 'movie' : 'series';
      const response = await this.services.request({ url: new URL(`https://v3-cinemeta.strem.io/meta/${kind}/${request.imdbId}.json`), expectedContent: 'json' }, signal);
      const meta = (response.json() as CinemetaResponse).meta;
      if (!meta?.name || !meta.moviedb_id) throw new Error(`Media metadata was not found for ${request.imdbId}`);
      const year = meta.releaseInfo?.match(/^\d{4}/)?.[0];
      identity = { ...request, tmdbId: meta.moviedb_id, title: meta.name, ...(year && { year: Number(year) }) };
    }
    if (!identity.tmdbId) throw new Error('Media metadata was not found for the request');
    const canonicalId = `tmdb:${identity.tmdbId}`;
    if (!this.tmdbAccessToken) return { ...identity, canonicalId, title: identity.title ?? '' };
    const response = await this.services.request({ url: new URL(`https://api.themoviedb.org/3/${identity.type === 'movie' ? 'movie' : 'tv'}/${identity.tmdbId}`), headers: { authorization: `Bearer ${this.tmdbAccessToken}` }, expectedContent: 'json' }, signal);
    const media = response.json() as TmdbTitle;
    const title = media.title ?? media.name;
    if (media.id !== identity.tmdbId || !title) throw new Error(`Media metadata was not found for TMDB ${identity.tmdbId}`);
    const date = media.release_date ?? media.first_air_date;
    return { ...identity, canonicalId, title, ...(date && { year: Number(date.slice(0, 4)) }) };
  }
}
