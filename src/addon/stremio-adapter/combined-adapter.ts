import type { Context } from '../../types';
import type { StremioStreamProvider, StremioStreamResult } from './legacy-adapter';

export class CombinedStremioAdapter implements StremioStreamProvider {
  public constructor(private readonly providers: readonly StremioStreamProvider[]) {}

  public async findStreams(ctx: Context, type: string, rawId: string): Promise<StremioStreamResult> {
    const settled = await Promise.allSettled(this.providers.map(provider => provider.findStreams(ctx, type, rawId)));
    const successes = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    if (!successes.length) throw (settled.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined)?.reason ?? new Error('No stream provider completed');
    const seen = new Set<string>();
    const streams = successes.flatMap(result => result.streams).filter((stream) => {
      const key = JSON.stringify(stream);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const ttls = successes.flatMap(result => result.ttl === undefined ? [] : [result.ttl]);
    return { streams, ...(ttls.length && { ttl: Math.min(...ttls) }) };
  }
}
