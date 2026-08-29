import { createHash } from 'node:crypto';
import type { NormalizedStream, RequestServices, StreamCandidate } from '../core/models';

export interface StreamInspector { inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> }

export class HlsInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
    const manifest = response.text().replace(/\r/g, '');
    if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('MANIFEST_INVALID');
    const lines = manifest.split('\n');
    const variants = lines.flatMap((line, index) => {
      if (!line.startsWith('#EXT-X-STREAM-INF:')) return [];
      const resolution = line.match(/RESOLUTION=(\d+)x(\d+)/i);
      const bandwidth = line.match(/BANDWIDTH=(\d+)/i);
      const codecs = line.match(/CODECS="([^"]+)"/i)?.[1]?.split(',').map(value => value.trim()) ?? [];
      return [{ uri: lines.slice(index + 1).find(value => value.trim() && !value.startsWith('#')) ?? '', width: Number(resolution?.[1]), height: Number(resolution?.[2]), bitrate: Number(bandwidth?.[1]), codecs }];
    }).filter(variant => variant.uri);
    const mediaPlaylist = lines.some(line => line.startsWith('#EXTINF:'));
    if (!variants.length && !mediaPlaylist) throw new Error('NO_PLAYABLE_VARIANTS');
    const best = [...variants].sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)[0];
    let mediaUrl = response.finalUrl;
    let mediaManifest = manifest;
    if (best) {
      mediaUrl = new URL(best.uri, response.finalUrl);
      const mediaResponse = await services.request({ url: mediaUrl, ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
      mediaUrl = mediaResponse.finalUrl;
      mediaManifest = mediaResponse.text().replace(/\r/g, '');
      if (!mediaManifest.trimStart().startsWith('#EXTM3U') || !mediaManifest.split('\n').some(line => line.startsWith('#EXTINF:'))) throw new Error('NO_PLAYABLE_VARIANTS');
    }
    const mediaLines = mediaManifest.split('\n');
    const resources = [
      ...mediaLines.flatMap(line => line.startsWith('#EXT-X-KEY:') || line.startsWith('#EXT-X-MAP:') ? [...line.matchAll(/URI="([^"]+)"/g)].map(match => match[1] as string) : []),
      ...mediaLines.filter(line => line.trim() && !line.startsWith('#')).slice(0, 1),
    ];
    if (!resources.length) throw new Error('NO_PLAYABLE_VARIANTS');
    for (const resource of resources) await services.request({ url: new URL(resource, mediaUrl), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'binary', timeoutMs: 6000, maxBytes: 64 * 1024 }, signal);
    const fingerprint = createHash('sha256').update(JSON.stringify(variants.map(({ width, height, bitrate, codecs }) => ({ width, height, bitrate, codecs })))).digest('hex');
    return {
      url: candidate.url, protocol: 'hls', validation: 'validated',
      ...(best?.width && best.height && { resolution: { width: best.width, height: best.height } }),
      ...(best?.bitrate && { bitrate: best.bitrate }),
      ...(best?.codecs[0] && { videoCodec: best.codecs[0] }),
      ...(best?.codecs[1] && { audioCodec: best.codecs[1] }),
      ...(candidate.language && { language: candidate.language }), ...(candidate.headers && { headers: candidate.headers }),
      sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), structuralFingerprint: `hls:${fingerprint}`,
    };
  }
}

export class DashInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
    const manifest = response.text();
    if (!/<MPD(?:\s|>)/i.test(manifest) || !/<(?:Representation|SegmentTemplate|SegmentList)(?:\s|>)/i.test(manifest)) throw new Error('MANIFEST_INVALID');
    const representations = [...manifest.matchAll(/<Representation\b([^>]*)>/gi)].map(match => ({ width: Number(match[1]?.match(/\bwidth="(\d+)"/)?.[1]), height: Number(match[1]?.match(/\bheight="(\d+)"/)?.[1]), bitrate: Number(match[1]?.match(/\bbandwidth="(\d+)"/)?.[1]), codec: match[1]?.match(/\bcodecs="([^"]+)"/)?.[1] })).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
    const best = representations[0];
    return { url: candidate.url, protocol: 'dash', validation: 'validated', ...(best?.width && best.height && { resolution: { width: best.width, height: best.height } }), ...(best?.bitrate && { bitrate: best.bitrate }), ...(best?.codec && { videoCodec: best.codec }), sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), structuralFingerprint: `dash:${createHash('sha256').update(JSON.stringify(representations)).digest('hex')}` };
  }
}

export class DirectMediaInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, method: 'HEAD', ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'binary', timeoutMs: 5000 }, signal);
    if (response.status < 200 || response.status >= 400) throw new Error('STREAM_EXPIRED');
    return { url: candidate.url, protocol: 'http', validation: 'validated', ...(candidate.declaredResolution && { resolution: candidate.declaredResolution }), sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), ...(candidate.headers && { headers: candidate.headers }) };
  }
}
