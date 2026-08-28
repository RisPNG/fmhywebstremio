import type { Stream } from 'stremio-addon-sdk';
import type { MediaRequest, NormalizedStream, StreamEngine } from '../../engine/core';
import type { Context } from '../../types';
import { envGetAppName } from '../../utils';
import type { StremioStreamResult } from './legacy-adapter';

export function parseStremioMediaRequest(type: string, rawId: string): MediaRequest {
  if (type !== 'movie' && type !== 'series') throw new Error(`Unsupported type: ${type}`);
  const parts = rawId.split(':');
  const episode = type === 'series' ? { season: Number(parts.at(-2)), episode: Number(parts.at(-1)) } : {};
  const base = type === 'series' && parts.length >= 3 ? parts.slice(0, -2).join(':') : rawId;
  if (base.startsWith('tmdb:')) return { type: type === 'movie' ? 'movie' : 'episode', tmdbId: Number(base.slice(5)), ...episode };
  if (base.startsWith('tt')) return { type: type === 'movie' ? 'movie' : 'episode', imdbId: base, ...episode };
  throw new Error(`Unsupported ID: ${rawId}`);
}

export function normalizedStreamToStremio(stream: NormalizedStream): Stream {
  return { url: stream.url.href, name: `${envGetAppName()}${stream.resolution ? `\n${stream.resolution.height}p` : ''}`, title: [stream.language, stream.sourceId, stream.hostExtractor].filter(Boolean).join(' · '), behaviorHints: { ...(stream.protocol !== 'http' && { notWebReady: true }), ...(stream.headers && { notWebReady: true, proxyHeaders: { request: stream.headers } }) } };
}

export class RuntimeStremioAdapter {
  public constructor(private readonly engine: StreamEngine) {}
  public async findStreams(ctx: Context, type: string, rawId: string): Promise<StremioStreamResult> {
    const result = await this.engine.findStreams(parseStremioMediaRequest(type, rawId), { excludedSourceIds: Object.keys(ctx.config).flatMap(key => key.startsWith('disableFmhySource_') ? [key.slice('disableFmhySource_'.length)] : []) });
    return { streams: result.streams.map(normalizedStreamToStremio) };
  }
}
