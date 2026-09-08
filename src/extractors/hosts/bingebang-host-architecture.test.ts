import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, MediaIdentity, RequestServices } from '../../engine/core/models';
import { TransportFailure } from '../../engine/transport/transport-director';
import { BingeBangPlayerHostArchitecture, decryptBingeBangEnvelope, readBingeBangPlayerConfiguration } from './bingebang-host-architecture';

describe('BingeBang player host architecture', () => {
  const player = new URL('https://bingebang.test/tv/play/the-boys-azkuo5');
  const episode: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', year: 2019, season: 2, episode: 1 };
  const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/bingebang/${name}`), 'utf8');
  const respond = (body: string, url: URL) => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
  const services = (page: string, requests: ExtractionRequest[] = []): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    requests.push(request);
    const source = request.url.searchParams.get('src');
    const body = source ? fixture(`resolve-${source}.json`) : request.url.pathname === '/api/player/sources' ? fixture('sources.json') : fixture(page);
    return respond(body, request.url);
  }) });

  test('decrypts the player envelope with the page ticket and rejects a foreign ticket', () => {
    const envelope = (JSON.parse(fixture('sources.json')) as { enc: string }).enc;
    expect(JSON.parse(decryptBingeBangEnvelope(envelope, 'fixture-ticket')) as { ok: boolean; servers: { label: string }[] }).toMatchObject({ ok: true, servers: expect.arrayContaining([expect.objectContaining({ label: 'Yildun', quality: '4K ULTRA HD' })]) as unknown });
    expect(() => JSON.parse(decryptBingeBangEnvelope(envelope, 'other-ticket'))).toThrow();
    expect(() => decryptBingeBangEnvelope('c2hvcnQ', 'fixture-ticket')).toThrow('shorter than its nonce');
    expect(readBingeBangPlayerConfiguration('<html></html>')).toBeUndefined();
  });

  test('requests the exact episode player and relays every resolved server with its referer', async () => {
    const requests: ExtractionRequest[] = [];
    const result = await new BingeBangPlayerHostArchitecture().discover(player, episode, 'bingebang:bingebang.test', 'bingebang', services('play-episode.html', requests), new AbortController().signal);
    expect(requests[0]?.url.pathname).toBe('/tv/play/the-boys-azkuo5/2/1');
    expect(requests[1]).toMatchObject({ url: new URL('https://bingebang.test/api/player/sources'), headers: { 'X-BB-Player': '1', 'X-BB-Ticket': 'fixture-ticket' } });
    expect(requests.map(request => request.url.searchParams.get('src')).filter(Boolean)).toEqual(['server-4k', 'server-progressive', 'server-unavailable']);
    expect(result).toMatchObject({ type: 'streams', streams: [
      { protocol: 'hls', delivery: 'relayed', headers: { referer: 'https://bingebang.test/' }, hostExtractor: 'bingebang-player', label: 'Yildun 4K ULTRA HD', declaredResolution: { width: 3840, height: 2160 } },
      { protocol: 'http', delivery: 'relayed', headers: { referer: 'https://bingebang.test/' }, label: 'Wezen FULL HD', declaredResolution: { width: 1920, height: 1080 } },
    ] });
    expect(result.type === 'streams' && result.streams).toHaveLength(2);
  });

  test('rejects a player page that answers with different coordinates or a missing episode', async () => {
    const host = new BingeBangPlayerHostArchitecture();
    await expect(host.discover(player, episode, 'bingebang:bingebang.test', 'bingebang', services('play-wrong-episode.html'), new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    await expect(host.discover(player, { ...episode, type: 'movie' }, 'bingebang:bingebang.test', 'bingebang', services('play-episode.html'), new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    const missing: RequestServices = { request: jest.fn(async () => {
      throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'HTTP request failed with status 404', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
    }) };
    await expect(host.discover(player, episode, 'bingebang:bingebang.test', 'bingebang', missing, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });

  test('preserves a typed failure when the player configuration or source envelope is gone', async () => {
    const host = new BingeBangPlayerHostArchitecture();
    await expect(host.discover(player, episode, 'bingebang:bingebang.test', 'bingebang', { request: jest.fn(async (request: ExtractionRequest) => respond('<html></html>', request.url)) }, new AbortController().signal))
      .resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', stage: 'stage:extraction', extractorId: 'bingebang-player', diagnostic: { parserPath: 'ticket' } } });
    await expect(host.discover(player, episode, 'bingebang:bingebang.test', 'bingebang', { request: jest.fn(async (request: ExtractionRequest) => respond(request.url.pathname === '/api/player/sources' ? '{}' : fixture('play-episode.html'), request.url)) }, new AbortController().signal))
      .resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', diagnostic: { parserPath: 'enc' } } });
  });
});
