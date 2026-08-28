import type { ContentType, Stream } from 'stremio-addon-sdk';
import type { Source } from '../../source';
import type { Context } from '../../types';
import { ImdbId, StreamResolver, TmdbId } from '../../utils';

export interface StremioStreamResult { streams: Stream[]; ttl?: number }
export interface StremioStreamProvider { findStreams(ctx: Context, type: string, rawId: string): Promise<StremioStreamResult> }

export class LegacyStremioAdapter implements StremioStreamProvider {
  public constructor(private readonly resolver: StreamResolver, private readonly sources: readonly Source[]) {}
  public async findStreams(ctx: Context, type: string, rawId: string): Promise<StremioStreamResult> {
    if (type !== 'movie' && type !== 'series') throw new Error(`Unsupported type: ${type}`);
    const id = rawId.startsWith('tmdb:') ? TmdbId.fromString(rawId.slice(5)) : rawId.startsWith('tt') ? ImdbId.fromString(rawId) : undefined;
    if (!id) throw new Error(`Unsupported ID: ${rawId}`);
    const sources = this.sources.filter(source => source.countryCodes.some(countryCode => countryCode in ctx.config));
    return this.resolver.resolve(ctx, sources as Source[], type as ContentType, id);
  }
}
