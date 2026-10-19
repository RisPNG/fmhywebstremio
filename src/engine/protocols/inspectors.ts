import { createHash } from 'node:crypto';
import { getOptions, parse, setOptions, type types } from 'hls-parser';
import type { NormalizedStream, RequestServices, StreamCandidate } from '../core/models';

setOptions({ silent: true });

export interface StreamInspector { inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> }

export class HlsInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
    const manifest = response.text().replace(/\r/g, '');
    if (!manifest.trimStart().startsWith('#EXTM3U')) throw new Error('MANIFEST_INVALID');
    const playlist = parse(manifest);
    if (playlist.isMasterPlaylist) {
      const options = getOptions();
      try {
        setOptions({ strictMode: true });
        parse(manifest);
      } catch {
        throw new Error('MANIFEST_INVALID');
      } finally {
        setOptions({ ...options, strictMode: options.strictMode ?? false });
      }
    }
    const variants = playlist.isMasterPlaylist ? playlist.variants.filter(variant => !variant.isIFrameOnly && variant.uri) : [];
    if (playlist.isMasterPlaylist && !variants.length) throw new Error('NO_PLAYABLE_VARIANTS');
    const best = [...variants].sort((a, b) => (b.resolution?.height ?? 0) - (a.resolution?.height ?? 0) || b.bandwidth - a.bandwidth)[0];
    const audio = best?.audio.find(rendition => rendition.isDefault) ?? best?.audio.find(rendition => rendition.autoselect) ?? best?.audio[0];
    if (best) {
      const inspected = await Promise.allSettled([...new Set([best.uri, audio?.uri].filter((uri): uri is string => Boolean(uri)))].map(async (uri) => {
        const mediaResponse = await services.request({ url: new URL(uri, response.finalUrl), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
        const mediaManifest = mediaResponse.text().replace(/\r/g, '');
        if (!mediaManifest.trimStart().startsWith('#EXTM3U')) throw new Error('NO_PLAYABLE_VARIANTS');
        const mediaPlaylist = parse(mediaManifest);
        if (mediaPlaylist.isMasterPlaylist) throw new Error('NO_PLAYABLE_VARIANTS');
        await this.inspectMediaPlaylist(mediaPlaylist, mediaResponse.finalUrl, candidate, services, signal);
      }));
      for (const result of inspected) if (result.status === 'rejected') throw result.reason;
    } else if (!playlist.isMasterPlaylist) {
      await this.inspectMediaPlaylist(playlist, response.finalUrl, candidate, services, signal);
    }
    const codecs = best?.codecs?.split(',').map(codec => codec.trim()) ?? [];
    const language = candidate.language ?? audio?.language;
    const fingerprint = createHash('sha256').update(JSON.stringify({ variants: variants.map(({ resolution, bandwidth, codecs }) => ({ resolution, bandwidth, codecs })), ...(audio && { audio: { language: audio.language, channels: audio.channels } }) })).digest('hex');
    return {
      url: candidate.url, protocol: 'hls', validation: 'validated',
      ...(best?.resolution && { resolution: best.resolution }),
      ...(best?.bandwidth && { bitrate: best.bandwidth }),
      ...(codecs[0] && { videoCodec: codecs[0] }),
      ...(codecs[1] && { audioCodec: codecs[1] }),
      ...(language && { language }), ...(audio?.language && { audioLanguages: [audio.language] }), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.delivery && { delivery: candidate.delivery }), ...(candidate.subtitles && { subtitles: candidate.subtitles }),
      sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), structuralFingerprint: `hls:${fingerprint}`,
    };
  }

  private async inspectMediaPlaylist(playlist: types.MediaPlaylist, mediaUrl: URL, candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<void> {
    const segments = playlist.segments.filter(segment => segment.uri);
    if (!segments.length) throw new Error('NO_PLAYABLE_VARIANTS');
    const resources = [...new Set([
      ...segments.flatMap(segment => [segment.key?.uri, segment.map?.uri]),
      segments[0]?.uri, segments[Math.floor(segments.length / 2)]?.uri, segments.at(-1)?.uri,
    ].filter((uri): uri is string => Boolean(uri)))];
    const inspected = await Promise.allSettled(resources.map(async resource => services.request({ url: new URL(resource, mediaUrl), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'binary', timeoutMs: 6000, maxBytes: 64 * 1024 }, signal)));
    for (const result of inspected) if (result.status === 'rejected') throw result.reason;
  }
}

export class DashInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'manifest', timeoutMs: 6000 }, signal);
    const manifest = response.text();
    if (!/<MPD(?:\s|>)/i.test(manifest) || !/<(?:Representation|SegmentTemplate|SegmentList)(?:\s|>)/i.test(manifest)) throw new Error('MANIFEST_INVALID');
    const representations = [...manifest.matchAll(/<Representation\b([^>]*)>/gi)].map(match => ({ width: Number(match[1]?.match(/\bwidth="(\d+)"/)?.[1]), height: Number(match[1]?.match(/\bheight="(\d+)"/)?.[1]), bitrate: Number(match[1]?.match(/\bbandwidth="(\d+)"/)?.[1]), codec: match[1]?.match(/\bcodecs="([^"]+)"/)?.[1] })).sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
    const best = representations[0];
    return { url: candidate.url, protocol: 'dash', validation: 'validated', ...(best?.width && best.height && { resolution: { width: best.width, height: best.height } }), ...(best?.bitrate && { bitrate: best.bitrate }), ...(best?.codec && { videoCodec: best.codec }), ...(candidate.language && { language: candidate.language }), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.delivery && { delivery: candidate.delivery }), ...(candidate.subtitles && { subtitles: candidate.subtitles }), sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), structuralFingerprint: `dash:${createHash('sha256').update(JSON.stringify(representations)).digest('hex')}` };
  }
}

export class DirectMediaInspector implements StreamInspector {
  public async inspect(candidate: StreamCandidate, services: RequestServices, signal: AbortSignal): Promise<NormalizedStream> {
    const response = await services.request({ url: candidate.url, method: 'HEAD', ...(candidate.headers && { headers: candidate.headers }), ...(candidate.referrer && { referrer: candidate.referrer }), expectedContent: 'binary', timeoutMs: 5000 }, signal);
    if (response.status < 200 || response.status >= 400) throw new Error('STREAM_EXPIRED');
    const contentType = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (contentType && ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/mpegurl', 'audio/x-mpegurl', 'audio/mpegurl'].includes(contentType)) return new HlsInspector().inspect(candidate, services, signal);
    if (contentType === 'application/dash+xml') return new DashInspector().inspect(candidate, services, signal);
    return { url: candidate.url, protocol: 'http', validation: 'validated', ...(candidate.declaredResolution && { resolution: candidate.declaredResolution }), ...(candidate.language && { language: candidate.language }), sourceId: candidate.sourceId, sourceExtractor: candidate.sourceExtractor, ...(candidate.hostExtractor && { hostExtractor: candidate.hostExtractor }), ...(candidate.providerContentId && { providerContentId: candidate.providerContentId }), ...(candidate.headers && { headers: candidate.headers }), ...(candidate.delivery && { delivery: candidate.delivery }), ...(candidate.subtitles && { subtitles: candidate.subtitles }) };
  }
}
