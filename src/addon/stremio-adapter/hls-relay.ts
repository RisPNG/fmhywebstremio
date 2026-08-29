import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export class HlsRelay {
  private readonly secret = randomBytes(32);

  public createUrl(origin: URL, target: URL): URL {
    const payload = Buffer.from(target.href).toString('base64url');
    const signature = createHmac('sha256', this.secret).update(payload).digest('base64url');
    const filename = /\.m3u8$/i.test(target.pathname) ? 'playlist.m3u8' : /\/page-\d+\.html$/i.test(target.pathname) ? 'segment.ts' : 'media.bin';
    return new URL(`/hls-relay/${signature}/${payload}/${filename}`, origin);
  }

  public resolveTarget(signature: string, payload: string): URL | null {
    const expected = createHmac('sha256', this.secret).update(payload).digest();
    let supplied: Buffer;
    try {
      supplied = Buffer.from(signature, 'base64url');
    } catch {
      return null;
    }
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
    try {
      const target = new URL(Buffer.from(payload, 'base64url').toString());
      return target.protocol === 'https:' ? target : null;
    } catch {
      return null;
    }
  }
}
