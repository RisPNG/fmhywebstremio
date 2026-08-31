import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface HlsRelayTarget { url: URL; headers?: Readonly<Record<string, string>> }

export class HlsRelay {
  private readonly secret = randomBytes(32);

  public createUrl(origin: URL, target: URL, headers?: Readonly<Record<string, string>>): URL {
    const payload = Buffer.from(JSON.stringify({ url: target.href, ...(headers && { headers }) })).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const nestedTarget = target.searchParams.get('url');
    const filename = /\.m3u8$/i.test(target.pathname) || (target.hostname === 'cdn.reallyfast.ch' && /^\/(?:playlist\/|v\/)/i.test(target.pathname)) || (nestedTarget && (/\.m3u8(?:$|\?)/i.test(nestedTarget) || /\/playlist\//i.test(nestedTarget) || /^https:\/\/cdn\.reallyfast\.ch\/v\//i.test(nestedTarget)))
      ? 'playlist.m3u8'
      : (/\.workers\.dev$/i.test(target.hostname) && /^\/seg\//i.test(target.pathname)) || (nestedTarget && /^https:\/\/[^/]+\.workers\.dev\/seg\//i.test(nestedTarget))
          ? 'segment.m4s'
          : /(?:\.ts$|\/page-\d+\.html$)/i.test(target.pathname) || Boolean(nestedTarget && /(?:\.ts|\/page-\d+\.html)(?:$|\?)/i.test(nestedTarget))
            ? 'segment.ts'
            : 'media.bin';
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
      const target = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { url?: string; headers?: Record<string, string> };
      const url = new URL(target.url ?? '');
      return url.protocol === 'https:' ? { url, ...(target.headers && { headers: target.headers }) } : null;
    } catch {
      return null;
    }
  }
}
