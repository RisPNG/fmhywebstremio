import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices } from '../../engine/core/models';
import { StreamSelector } from '../../engine/protocols';
import type { VidsrcMeEnvelopeDecoder } from './vidsrcme-host-architecture';
import { VidsrcMeApiHostArchitecture, WasmVidsrcMeEnvelopeDecoder } from './vidsrcme-host-architecture';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinego/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('VidsrcMe API host architecture', () => {
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };

  test.each(['encrypted', 'decoded'])('validates every %s mirror when the first tokenized playlist is expired', async (format) => {
    const urls = ['https://media.vidsrcme.test/expired.m3u8', 'https://media.vidsrcme.test/master.m3u8', 'https://backup.vidsrcme.test/master.m3u8'];
    const decoder: VidsrcMeEnvelopeDecoder = { decrypt: jest.fn(async () => urls) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === 'vsembed.test' && request.url.pathname.startsWith('/embed/')) return response(request.url, '<iframe id="player_iframe" data-api="/vs_src.php?type=movie&amp;id=27205"></iframe>');
      if (request.url.pathname === '/vs_src.php') return response(request.url, JSON.stringify({ src: 'https://player.test/embed/movie/27205?vs=fixture-wrapper-grant' }));
      if (request.url.hostname === 'player.test' && request.url.pathname === '/embed/movie/27205') return response(request.url, '<script>window.CFG = {"playerUrl":"/embed/player/movie/27205?vs=fixture-player-grant"};</script>');
      if (request.url.hostname === 'player.test') return response(request.url, '<script>window.CONFIG = {"mediaType":"movie","tmdb":"27205","api":"https://data.vidsrcme.ru/api.php?type=movie&tmdb=27205&stream_urls","apiToken":"fixture-single-use-token"};</script>');
      if (request.url.hostname === 'data.vidsrcme.ru') return response(request.url, format === 'encrypted' ? fixture('vidsrcme-movie.json') : JSON.stringify({ data: { stream_urls: urls, title: 'Inception' } }));
      if (request.url.pathname === '/generate.php') return response(request.url, `token-${request.url.hostname}`);
      if (request.url.pathname === '/expired.m3u8') return response(request.url, '<html>Expired stream</html>');
      if (request.expectedContent === 'binary') return response(request.url, 'fixture-segment');
      return response(request.url, fixture(request.url.pathname === '/video-720.m3u8' ? 'media.m3u8' : 'master.m3u8'));
    }) };
    const signal = new AbortController().signal;
    const result = await new VidsrcMeApiHostArchitecture(decoder).discover(movie, new URL('https://vsembed.test/embed/movie/27205'), 'cinego:cinego.test', 'cinego', services, signal);
    expect(result).toMatchObject({ type: 'streams', streams: urls.map(value => ({ url: new URL(`${value}?token=token-${new URL(value).hostname}`), protocol: 'hls', delivery: 'relayed', sourceId: 'cinego:cinego.test', sourceExtractor: 'cinego', hostExtractor: 'vidsrcme-api' })) });
    expect((services.request as jest.Mock).mock.calls.filter(([request]: [ExtractionRequest]) => request.url.pathname === '/generate.php')).toHaveLength(2);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://data.vidsrcme.ru/api.php?type=movie&tmdb=27205&stream_urls=&api_token=fixture-single-use-token'), referrer: new URL('https://player.test/embed/player/movie/27205?vs=fixture-player-grant') }), signal);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://player.test/embed/player/movie/27205?vs=fixture-player-grant'), referrer: new URL('https://player.test/embed/movie/27205?vs=fixture-wrapper-grant') }), signal);
    if (result.type !== 'streams') throw new Error('VidsrcMe did not return stream candidates');
    const validation = await new StreamSelector(services).validate(result.streams, { concurrency: 2 }, signal);
    expect(validation.streams).toHaveLength(2);
    expect(validation.streams).toEqual(expect.arrayContaining(urls.slice(1).map(value => expect.objectContaining({ url: new URL(`${value}?token=token-${new URL(value).hostname}`), validation: 'validated', delivery: 'relayed' }))));
    expect(validation.failures).toMatchObject([{ code: 'MANIFEST_INVALID', extractorId: 'vidsrcme-api' }]);
    for (const value of urls) expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL(`${value}?token=token-${new URL(value).hostname}`), expectedContent: 'manifest' }), signal);
    for (const hostname of ['media.vidsrcme.test', 'backup.vidsrcme.test']) expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL(`https://${hostname}/segment-1.ts`), expectedContent: 'binary' }), signal);
  });

  test('uses the episode player stream base with its exact season, episode, and single-use grant', async () => {
    const media: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', year: 2019, season: 2, episode: 1 };
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.hostname === 'player.test') return response(request.url, '<script>window.CONFIG = {"mediaType":"tv","tmdb":"76479","season":2,"episode":1,"streamBase":"https://data.current.test/api.php?type=tv&tmdb=76479","apiToken":"episode-token"};</script>');
      if (request.url.hostname === 'data.current.test') return response(request.url, JSON.stringify({ data: { stream_urls: ['https://media.test/master.m3u8'] } }));
      return response(request.url, 'host-token');
    }) };
    const signal = new AbortController().signal;
    await expect(new VidsrcMeApiHostArchitecture().discover(media, new URL('https://player.test/embed/player/tv/76479/2/1'), 'source', 'sixty-seven-movies', services, signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8?token=host-token'), delivery: 'relayed' }] });
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://data.current.test/api.php?type=tv&tmdb=76479&season=2&episode=1&stream_urls=&api_token=episode-token') }), signal);
  });

  test.each([
    { configuration: { mediaType: 'movie', tmdb: '999', api: 'https://api.test/', apiToken: 'grant' }, code: 'RESULT_MAPPING_FAILED' },
    { configuration: { mediaType: 'tv', tmdb: '27205', api: 'https://api.test/', apiToken: 'grant' }, code: 'RESULT_MAPPING_FAILED' },
    { configuration: { mediaType: 'movie', tmdb: '27205', api: 'https://api.test/' }, code: 'RESPONSE_SCHEMA_CHANGED' },
  ])('rejects changed player identity or missing grants before contacting a stream API', async ({ configuration, code }) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, `<script>window.CONFIG = ${JSON.stringify(configuration)};</script>`)) };
    await expect(new VidsrcMeApiHostArchitecture().discover(movie, new URL('https://player.test/'), 'source', 'sixty-seven-movies', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('does not publish a single-use stream token in schema failure diagnostics', async () => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, request.url.hostname === 'player.test' ? '<script>window.CONFIG = {"mediaType":"movie","tmdb":"27205","api":"https://api.test/api.php?stream_urls","apiToken":"private-issued-token"};</script>' : '{"data":{}}')) };
    const result = await new VidsrcMeApiHostArchitecture().discover(movie, new URL('https://player.test/'), 'source', 'sixty-seven-movies', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', diagnostic: { finalUrl: 'https://api.test/api.php?stream_urls=&api_token=' } } });
    expect(JSON.stringify(result)).not.toContain('private-issued-token');
  });

  test.each([{ season: 1, episode: 1 }, { season: 2, episode: 2 }])('rejects a different configured episode before contacting the stream API', async ({ season, episode }) => {
    const services: RequestServices = { request: jest.fn(async request => response(request.url, `<script>window.CONFIG = ${JSON.stringify({ mediaType: 'tv', tmdb: '76479', season, episode, streamBase: 'https://api.test/', apiToken: 'grant' })};</script>`)) };
    await expect(new VidsrcMeApiHostArchitecture().discover({ canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, title: 'The Boys', season: 2, episode: 1 }, new URL('https://player.test/'), 'source', 'sixty-seven-movies', services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED' } });
    expect(services.request).toHaveBeenCalledTimes(1);
  });

  test('retries a shared host token for a later mirror after its first issuance fails', async () => {
    const decoder: VidsrcMeEnvelopeDecoder = { decrypt: jest.fn(async () => ['https://media.test/first.m3u8', 'https://media.test/second.m3u8']) };
    let attempts = 0;
    const services: RequestServices = { request: jest.fn(async (request) => {
      if (request.url.hostname === 'player.test') return response(request.url, '<script>window.CONFIG = {"mediaType":"movie","tmdb":"27205","api":"https://api.test/api.php?stream_urls","apiToken":"grant"};</script>');
      if (request.url.hostname === 'api.test') return response(request.url, fixture('vidsrcme-movie.json'));
      if (++attempts === 1) throw new Error('token issuer temporarily unavailable');
      return response(request.url, 'retry-token');
    }) };
    await expect(new VidsrcMeApiHostArchitecture(decoder).discover(movie, new URL('https://player.test/'), 'source', 'sixty-seven-movies', services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams', streams: [{ url: new URL('https://media.test/second.m3u8?token=retry-token') }] });
    expect(attempts).toBe(2);
  });

  test.each(['https://one.test/master.m3u8https://two.test/master.m3u8', 'https://one.test/master.m3u8\nhttps://two.test/master.m3u8\n'])('decodes current newline-separated and older concatenated mirror envelopes', async (plaintext) => {
    const memory = { buffer: new ArrayBuffer(4096) };
    const webAssembly = (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly;
    (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = { instantiate: async () => ({ instance: { exports: { memory, alloc: () => 100, decrypt: () => {
      new Uint8Array(memory.buffer, 112, Buffer.byteLength(plaintext)).set(Buffer.from(plaintext));
      return Buffer.byteLength(plaintext);
    } } } }) };
    try {
      const services: RequestServices = { request: jest.fn(async request => response(request.url, 'fixture')) };
      await expect(new WasmVidsrcMeEnvelopeDecoder().decrypt('Zml4dHVyZQ==', new URL('https://api.test/fixture.wasm'), services, new AbortController().signal)).resolves.toEqual(['https://one.test/master.m3u8', 'https://two.test/master.m3u8']);
    } finally {
      (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = webAssembly;
    }
  });
});
