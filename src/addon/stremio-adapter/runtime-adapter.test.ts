import type { StreamEngine } from '../../engine/core';
import { DirectMediaInspector } from '../../engine/protocols';
import type { Context } from '../../types';
import { HlsRelay } from './hls-relay';
import { normalizedStreamToStremio, RuntimeStremioAdapter } from './runtime-adapter';

describe('RuntimeStremioAdapter', () => {
  test('relays only streams from IP-bound host architectures', async () => {
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: [{ url: target, protocol: 'hls' as const, validation: 'validated' as const, resolution: { width: 1920, height: 800 }, delivery: 'relayed' as const, sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const relay = new HlsRelay();
    const context: Context = { hostUrl: new URL('https://addon.example/'), id: 'fixture', config: {} };
    const result = await new RuntimeStremioAdapter(engine, relay).findStreams(context, 'movie', 'tt1375666');
    const url = new URL(result.streams[0]?.url as string);
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)\/playlist\.m3u8$/) ?? [];
    expect(url.origin).toBe(context.hostUrl.origin);
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual({ url: target, resource: { kind: 'playlist' } });
    expect(result.streams[0]).toMatchObject({ name: 'cinego.test 800p\n800p', title: 'cinego:cinego.test · vidsrcme-api' });
  });

  test.each(['hls', 'dash', 'http'] as const)('signs root resource semantics from %s rather than its opaque URL', async (protocol) => {
    const target = new URL('https://media.test/opaque-image.png');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: [{ url: target, protocol, validation: 'validated' as const, delivery: 'relayed' as const, headers: { referer: 'https://player.test/' }, sourceId: 'source', sourceExtractor: 'source' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const relay = new HlsRelay();
    const result = await new RuntimeStremioAdapter(engine, relay).findStreams({ hostUrl: new URL('https://addon.test/'), id: 'fixture', config: {} }, 'movie', 'tmdb:27205');
    const url = new URL(result.streams[0]?.url as string);
    const parts = url.pathname.split('/');
    expect(parts.at(-1)).toBe(protocol === 'hls' ? 'playlist.m3u8' : protocol === 'dash' ? 'manifest.mpd' : 'media.bin');
    expect(relay.resolveTarget(parts.at(-3) as string, parts.at(-2) as string)).toEqual({ url: target, headers: { referer: 'https://player.test/' }, resource: protocol === 'hls' ? { kind: 'playlist' } : protocol === 'dash' ? { kind: 'file', format: 'dash' } : { kind: 'file' } });
  });
});

test('preserves external subtitles through protocol validation and Stremio serialization', async () => {
  const stream = await new DirectMediaInspector().inspect({ url: new URL('https://media.test/video.mp4'), protocol: 'http', sourceId: 'anicine:catalog.test', sourceExtractor: 'anicine', discoveredAt: new Date(0), subtitles: [{ url: new URL('https://subtitles.test/english.vtt'), label: 'English', format: 'vtt' }] }, { request: jest.fn(async () => ({ status: 200, headers: { 'content-type': 'video/mp4' }, finalUrl: new URL('https://media.test/video.mp4'), redirectChain: [], body: new Uint8Array([1]), text: () => '', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) }, new AbortController().signal);
  expect(normalizedStreamToStremio(stream).subtitles).toEqual([{ id: 'https://subtitles.test/english.vtt', url: 'https://subtitles.test/english.vtt', lang: 'English' }]);
});
