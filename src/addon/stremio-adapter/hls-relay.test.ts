import { HlsRelay } from './hls-relay';

describe('HlsRelay', () => {
  test('creates signed relay URLs and rejects tampering', () => {
    const relay = new HlsRelay();
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const url = relay.createUrl(new URL('https://addon.example/'), target, { referer: 'https://player.example/' });
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(signature).toBeDefined();
    expect(payload).toBeDefined();
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual({ url: target, headers: { referer: 'https://player.example/' } });
    expect(relay.resolveTarget(`${signature}x`, payload as string)).toBeNull();
    expect(relay.resolveTarget(signature as string, `${payload}x`)).toBeNull();
  });

  test('preserves HLS-safe suffixes for nested proxy playlists and segments', () => {
    const relay = new HlsRelay();
    const origin = new URL('https://addon.example/');
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fmedia.example%2Fmaster.m3u8')).pathname).toMatch(/\/playlist\.m3u8$/);
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fmedia.example%2Fplaylist%2Fp%2Ftoken')).pathname).toMatch(/\/playlist\.m3u8$/);
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fcdn.reallyfast.ch%2Fv%2Ftoken')).pathname).toMatch(/\/playlist\.m3u8$/);
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fa.thempark.workers.dev%2Fseg%2Ftoken')).pathname).toMatch(/\/segment\.m4s$/);
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fmedia.example%2Fsegment.ts')).pathname).toMatch(/\/segment\.ts$/);
    expect(relay.createUrl(origin, new URL('https://proxy.example/v?url=https%3A%2F%2Fmedia.example%2Fsegment')).pathname).toMatch(/\/media\.bin$/);
    expect(relay.createUrl(origin, new URL('https://cdn.reallyfast.ch/v/token')).pathname).toMatch(/\/playlist\.m3u8$/);
    expect(relay.createUrl(origin, new URL('https://a.thempark.workers.dev/seg/token')).pathname).toMatch(/\/segment\.m4s$/);
  });
});
