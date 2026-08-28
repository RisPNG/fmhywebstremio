import type { MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidriftSourceResponse {
  streams?: readonly { url?: string; proxyUrl?: string; type?: string; provider?: string }[];
}

export interface VidriftHostArchitecture {
  discover(media: MediaIdentity, sourceId: string, grantOrigin: URL, services: RequestServices, signal: AbortSignal): Promise<readonly StreamCandidate[]>;
}

export class VidriftApiHostArchitecture implements VidriftHostArchitecture {
  public async discover(media: MediaIdentity, sourceId: string, grantOrigin: URL, services: RequestServices, signal: AbortSignal): Promise<readonly StreamCandidate[]> {
    if (!media.tmdbId) return [];
    const tokenResponse = await services.request({
      url: new URL('/api/playback-token', grantOrigin),
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tmdbId: media.tmdbId, type: media.type === 'movie' ? 'movie' : 'tv', ...(media.type === 'episode' && { season: media.season, episode: media.episode }) }),
      expectedContent: 'binary',
      stateScope: { kind: 'source', key: sourceId },
    }, signal);
    const token = (tokenResponse.json() as { token?: string }).token;
    if (!token) return [];
    const path = media.type === 'movie' ? `/api/source/movie/${media.tmdbId}` : `/api/source/tv/${media.tmdbId}/${media.season}/${media.episode}`;
    const sourceUrl = new URL(path, 'https://embed.vidrift.in');
    sourceUrl.searchParams.set('token', token);
    sourceUrl.searchParams.set('provider', 'selfhost');
    const sourceResponse = await services.request({ url: sourceUrl, expectedContent: 'binary', referrer: grantOrigin, stateScope: { kind: 'host', key: sourceUrl.hostname } }, signal);
    return ((sourceResponse.json() as VidriftSourceResponse).streams ?? []).flatMap((stream) => {
      const value = stream.url || stream.proxyUrl;
      if (!value) return [];
      const url = new URL(value, sourceResponse.finalUrl);
      return [{ url, protocol: stream.type === 'hls' || /\.m3u8(?:$|\?)/i.test(url.href) ? 'hls' as const : 'http' as const, sourceId, sourceExtractor: 'cinrift', hostExtractor: 'vidrift-api', ...(stream.provider && { label: stream.provider }), discoveredAt: new Date() }];
    });
  }
}
