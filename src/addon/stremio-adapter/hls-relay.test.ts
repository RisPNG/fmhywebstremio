import { HlsRelay } from './hls-relay';

describe('HlsRelay', () => {
  test('creates signed relay URLs and rejects tampering', () => {
    const relay = new HlsRelay();
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const url = relay.createUrl(new URL('https://addon.example/'), target);
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(signature).toBeDefined();
    expect(payload).toBeDefined();
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual(target);
    expect(relay.resolveTarget(`${signature}x`, payload as string)).toBeNull();
    expect(relay.resolveTarget(signature as string, `${payload}x`)).toBeNull();
  });
});
