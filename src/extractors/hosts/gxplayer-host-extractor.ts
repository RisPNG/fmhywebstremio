import type { ExtractionResult, ExtractionTarget, Extractor, MatchResult, RequestServices } from '../../engine/core/models';

interface GxPlayerVideo { uid: string; md5: string; id: string; status: string; quality?: string | null }

export default class GxPlayerHostExtractor implements Extractor {
  public readonly id = 'gxplayer';

  public match(target: ExtractionTarget): MatchResult | null {
    return /(?:^|\.)(?:watch\.gxplayer\.xyz|bullstream\.[a-z]+|mp4player\.[a-z]+)$/i.test(target.url.hostname) ? { matcherId: 'gxplayer-page', confidence: 20 } : null;
  }

  public async extract(target: ExtractionTarget, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const response = await services.request({ url: target.url, ...(target.referrer && { referrer: target.referrer }), expectedContent: 'html', stateScope: { kind: 'host', key: target.url.hostname } }, signal);
    if (/Video is not ready/i.test(response.text())) return { type: 'empty', reason: 'no-streams' };
    const encoded = response.text().match(/(?:var\s+)?video\s*=\s*(\{.*?\});/s)?.[1];
    if (!encoded) return { type: 'failure', failure: { code: 'SCRIPT_DATA_MISSING', message: 'GXPlayer video metadata was not found', extractorId: this.id, targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: false } } };
    let video: GxPlayerVideo;
    try {
      video = JSON.parse(encoded) as GxPlayerVideo;
    } catch {
      return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'GXPlayer video metadata is not valid JSON', extractorId: this.id, targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: false } } };
    }
    if (!video.uid || !video.md5 || !video.id) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'GXPlayer video metadata is incomplete', extractorId: this.id, targetHost: response.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: false } } };
    const url = new URL(`/m3u8/${video.uid}/${video.md5}/master.txt`, response.finalUrl.origin);
    url.searchParams.set('s', '1');
    url.searchParams.set('id', video.id);
    url.searchParams.set('cache', video.status);
    let height: number | undefined;
    try {
      const first = video.quality && (JSON.parse(video.quality) as unknown[])[0];
      const parsed = typeof first === 'string' ? Number.parseInt(first) : Number.NaN;
      if (parsed > 0) height = parsed;
    } catch {
      height = undefined;
    }
    return { type: 'streams', streams: [{ url, protocol: 'hls', referrer: new URL(response.finalUrl.origin), headers: { referer: response.finalUrl.origin }, ...(height && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), sourceId: String(target.hints?.['sourceId'] ?? target.url.hostname), sourceExtractor: String(target.hints?.['sourceExtractor'] ?? this.id), hostExtractor: this.id, discoveredAt: new Date() }] };
  }
}
