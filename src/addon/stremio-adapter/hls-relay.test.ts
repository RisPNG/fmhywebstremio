import { HlsRelay, type HlsRelayResource } from './hls-relay';

describe('HlsRelay', () => {
  test('creates signed relay URLs and rejects tampering', () => {
    const relay = new HlsRelay();
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const url = relay.createUrl(new URL('https://addon.example/'), { url: target, headers: { referer: 'https://player.example/' }, resource: { kind: 'playlist' } });
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(signature).toBeDefined();
    expect(payload).toBeDefined();
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual({ url: target, headers: { referer: 'https://player.example/' }, resource: { kind: 'playlist' } });
    expect(relay.resolveTarget(`${signature}x`, payload as string)).toBeNull();
    expect(relay.resolveTarget(signature as string, `${payload}x`)).toBeNull();
    const altered = Buffer.from(JSON.stringify({ url: target.href, headers: { referer: 'https://player.example/' }, resource: { kind: 'segment', format: 'mpegts' } })).toString('base64url');
    expect(relay.resolveTarget(signature as string, altered)).toBeNull();
  });

  test.each<{ resource: HlsRelayResource; filename: string }>([
    { resource: { kind: 'playlist' }, filename: 'playlist.m3u8' },
    { resource: { kind: 'segment', format: 'mpegts' }, filename: 'segment.ts' },
    { resource: { kind: 'segment', format: 'fmp4' }, filename: 'segment.m4s' },
    { resource: { kind: 'initialization', format: 'fmp4' }, filename: 'init.mp4' },
    { resource: { kind: 'segment', format: 'aac' }, filename: 'segment.aac' },
    { resource: { kind: 'segment', format: 'vtt' }, filename: 'segment.vtt' },
    { resource: { kind: 'key' }, filename: 'key.key' },
    { resource: { kind: 'file' }, filename: 'media.bin' },
    { resource: { kind: 'file', format: 'dash' }, filename: 'manifest.mpd' },
  ])('uses the signed resource semantics for $filename regardless of the upstream path', ({ resource, filename }) => {
    const relay = new HlsRelay();
    const origin = new URL('https://addon.example/');
    for (const upstream of ['https://media.test/opaque', 'https://media.test/image.png', 'https://proxy.test/resource?url=https%3A%2F%2Fmedia.test%2Fphoto.jpg']) {
      const target = { url: new URL(upstream), resource };
      const url = relay.createUrl(origin, target);
      expect(url.pathname.endsWith(`/${filename}`)).toBe(true);
      const parts = url.pathname.split('/');
      expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual(target);
    }
  });
});
