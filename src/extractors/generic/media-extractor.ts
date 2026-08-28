import type { ExtractionResult, ExtractionTarget, Extractor, MatchResult, RequestServices, StreamProtocol } from '../../engine/core/models';

export default class MediaExtractor implements Extractor {
  public readonly id = 'generic-media';
  public match(target: ExtractionTarget): MatchResult | null {
    return /\.(?:m3u8|mpd|mp4|webm)(?:$|\?)/i.test(target.url.href) ? { matcherId: 'media-url', confidence: 10 } : null;
  }

  public async extract(target: ExtractionTarget, _services: RequestServices, _signal: AbortSignal): Promise<ExtractionResult> {
    void _services;
    void _signal;
    const extension = target.url.pathname.split('.').pop()?.toLowerCase();
    const protocol: StreamProtocol = extension === 'm3u8' ? 'hls' : extension === 'mpd' ? 'dash' : extension === 'mp4' || extension === 'webm' ? 'http' : 'unknown';
    return { type: 'streams', streams: [{ url: target.url, protocol, ...(target.referrer && { referrer: target.referrer }), sourceId: String(target.hints?.['sourceId'] ?? target.url.hostname), sourceExtractor: String(target.hints?.['sourceExtractor'] ?? this.id), hostExtractor: this.id, discoveredAt: new Date() }] };
  }
}
