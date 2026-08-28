import * as cheerio from 'cheerio';
import type { ExtractionResult, ExtractionTarget, Extractor, MatchResult, RequestServices, StreamCandidate, StreamProtocol } from '../../engine/core/models';

export default class EmbedPageExtractor implements Extractor {
  public readonly id = 'generic-embed-page';
  public match(target: ExtractionTarget): MatchResult | null { return ['http:', 'https:'].includes(target.url.protocol) && target.kind !== 'manifest' && target.kind !== 'direct-media' ? { matcherId: 'html-page', confidence: 1 } : null; }
  public async extract(target: ExtractionTarget, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const response = await services.request({ url: target.url, ...(target.referrer && { referrer: target.referrer }), expectedContent: 'html', stateScope: { kind: 'source', key: String(target.hints?.['sourceId'] ?? target.url.hostname) } }, signal);
    const $ = cheerio.load(response.text());
    const urls = [...new Set([
      ...$('iframe[src],video[src],video source[src]').map((_index, element) => $(element).attr('src')).get(),
      ...[...response.text().matchAll(/https?:\\?\/\\?\/[^\s"'<>]+?\.(?:m3u8|mpd|mp4)(?:\?[^\s"'<>]*)?/gi)].map(match => match[0]?.replace(/\\\//g, '/') as string),
    ].filter((value): value is string => Boolean(value)).map(value => new URL(value, response.finalUrl).href))];
    if (!urls.length) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'No supported embeds or media URLs were found', extractorId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: false } } };
    const streams: StreamCandidate[] = [];
    const embeds: ExtractionTarget[] = [];
    for (const value of urls) {
      const url = new URL(value);
      const extension = url.pathname.split('.').pop()?.toLowerCase();
      const protocol: StreamProtocol = extension === 'm3u8' ? 'hls' : extension === 'mpd' ? 'dash' : extension === 'mp4' ? 'http' : 'unknown';
      if (protocol === 'unknown') embeds.push({ url, kind: 'embed', referrer: response.finalUrl, ...(target.media && { media: target.media }), ...(target.hints && { hints: target.hints }) });
      else streams.push({ url, protocol, referrer: response.finalUrl, sourceId: String(target.hints?.['sourceId'] ?? target.url.hostname), sourceExtractor: String(target.hints?.['sourceExtractor'] ?? this.id), hostExtractor: this.id, discoveredAt: new Date() });
    }
    if (streams.length && !embeds.length) return { type: 'streams', streams };
    if (!streams.length) return { type: 'embeds', targets: embeds };
    return { type: 'embeds', targets: [...embeds, ...streams.map(stream => ({ url: stream.url, kind: stream.protocol === 'http' ? 'direct-media' as const : 'manifest' as const, ...(stream.referrer && { referrer: stream.referrer }), ...(target.media && { media: target.media }), hints: { ...target.hints, sourceId: stream.sourceId, sourceExtractor: stream.sourceExtractor } }))] };
  }
}
