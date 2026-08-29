import type { StreamEngine } from '../../engine/core';
import type { Context } from '../../types';
import { HlsRelay } from './hls-relay';
import { RuntimeStremioAdapter } from './runtime-adapter';

describe('RuntimeStremioAdapter', () => {
  test('relays only streams from IP-bound host architectures', async () => {
    const target = new URL('https://media.example/movie/master.m3u8?token=fixture');
    const engine: StreamEngine = { findStreams: jest.fn(async () => ({ streams: [{ url: target, protocol: 'hls' as const, validation: 'validated' as const, sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' }], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 1, sourcesCompleted: 1, sourcesCancelled: 0 } })) };
    const relay = new HlsRelay();
    const context: Context = { hostUrl: new URL('https://addon.example/'), id: 'fixture', config: {} };
    const result = await new RuntimeStremioAdapter(engine, relay).findStreams(context, 'movie', 'tt1375666');
    const url = new URL(result.streams[0]?.url as string);
    const [, signature, payload] = url.pathname.match(/^\/hls-relay\/([^/]+)\/([^/]+)$/) ?? [];
    expect(url.origin).toBe(context.hostUrl.origin);
    expect(relay.resolveTarget(signature as string, payload as string)).toEqual(target);
  });
});
