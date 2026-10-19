import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const hlsMediaFormats = {
  mpegts: { extension: 'ts', contentType: 'video/mp2t' },
  fmp4: { extension: 'm4s', contentType: 'video/mp4' },
  aac: { extension: 'aac', contentType: 'audio/aac' },
  vtt: { extension: 'vtt', contentType: 'text/vtt' },
} as const;

export type HlsMediaFormat = keyof typeof hlsMediaFormats;
export type HlsRelayResource = { kind: 'playlist'; format?: HlsMediaFormat } | { kind: 'segment' | 'initialization'; format: HlsMediaFormat } | { kind: 'key' } | { kind: 'file'; format?: 'dash' };
export interface HlsRelayTarget { url: URL; headers?: Readonly<Record<string, string>>; resource: HlsRelayResource }

export class HlsRelay {
  private readonly secret = randomBytes(32);

  public createUrl(origin: URL, target: HlsRelayTarget): URL {
    const payload = Buffer.from(JSON.stringify({ ...target, url: target.url.href })).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const resource = target.resource;
    const filename = resource.kind === 'playlist'
      ? 'playlist.m3u8'
      : resource.kind === 'segment'
        ? `segment.${hlsMediaFormats[resource.format].extension}`
        : resource.kind === 'initialization'
          ? `init.${resource.format === 'fmp4' ? 'mp4' : hlsMediaFormats[resource.format].extension}`
          : resource.kind === 'key'
            ? 'key.key'
            : resource.format === 'dash' ? 'manifest.mpd' : 'media.bin';
    return new URL(`/hls-relay/${signature}/${payload}/${filename}`, origin);
  }

  public resolveTarget(signature: string, payload: string): HlsRelayTarget | null {
    const expected = createHmac('sha256', this.secret).update(payload).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      return null;
    }
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
    try {
      const target = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { url?: string; headers?: Record<string, string>; resource: HlsRelayResource };
      const url = new URL(target.url ?? '');
      return url.protocol === 'https:' ? { url, ...(target.headers && { headers: target.headers }), resource: target.resource } : null;
    } catch {
      return null;
    }
  }
}
