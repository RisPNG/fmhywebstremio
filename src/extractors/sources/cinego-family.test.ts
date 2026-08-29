import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import type { VidsrcMeEnvelopeDecoder } from '../hosts/vidsrcme-host-architecture';
import { VidsrcMeApiHostArchitecture, WasmVidsrcMeEnvelopeDecoder } from '../hosts/vidsrcme-host-architecture';
import { CinegoFamily } from './cinego-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinego/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('CineGo source family and VidsrcMe host architecture', () => {
  const source: SourceRecord = { id: 'cinego:cinego.test', canonicalDomain: 'cinego.test', aliases: [], fmhy: { section: 'Multi-Server', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'cinego', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared catalog and player fingerprint', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinego.test/'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new CinegoFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cinego', confidence: 1, evidence: [{ fingerprint: 'cinego-client' }, { value: 'cinego-catalog-routes' }, { fingerprint: 'cinego-player-grant' }] });
  });

  test('splits concatenated mirror URLs from the encrypted host envelope', async () => {
    const memory = { buffer: new ArrayBuffer(4096) };
    const plaintext = 'https://one.test/master.m3u8https://two.test/master.m3u8';
    const webAssembly = (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly;
    (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = { instantiate: async () => ({ instance: { exports: { memory, alloc: () => 100, decrypt: () => {
      new Uint8Array(memory.buffer, 112, Buffer.byteLength(plaintext)).set(Buffer.from(plaintext));
      return Buffer.byteLength(plaintext);
    } } } }) };
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, 'fixture', 'application/wasm')) };
    await expect(new WasmVidsrcMeEnvelopeDecoder().decrypt('Zml4dHVyZQ==', new URL('https://data.vidsrcme.test/fixture.wasm'), services, new AbortController().signal)).resolves.toEqual(['https://one.test/master.m3u8', 'https://two.test/master.m3u8']);
    (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = webAssembly;
  });

  test('discovers movie and episode catalog entries and validates fresh tokenized streams', async () => {
    const decoder: VidsrcMeEnvelopeDecoder = { decrypt: jest.fn(async envelope => [`https://media.vidsrcme.test/${envelope}/master.m3u8`, `https://media.vidsrcme.test/${envelope}/backup.m3u8`]) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/searching') {
        if (request.url.searchParams.get('q') === 'Inception') return response(request.url.href, fixture('search-inception.json'));
        if (request.url.searchParams.get('q') === 'Breaking Bad') return response(request.url.href, fixture('search-breaking-bad.json'));
        if (request.url.searchParams.get('q') === 'Loki') return response(request.url.href, fixture('search-loki.json'));
        return response(request.url.href, fixture('search-absent.json'));
      }
      if (request.url.hostname === 'data.vidsrcme.ru') return response(request.url.href, fixture(request.url.searchParams.get('type') === 'movie' ? 'vidsrcme-movie.json' : 'vidsrcme-episode.json'));
      if (request.url.pathname === '/generate.php') return response(request.url.href, 'fixture-token', 'text/plain');
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      return response(request.url.href, fixture(request.url.pathname.endsWith('video-720.m3u8') ? 'media.m3u8' : 'master.m3u8'), 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const family = new CinegoFamily(new VidsrcMeApiHostArchitecture(decoder));
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: 'cinego', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:84958:2:1', type: 'episode', tmdbId: 84958, title: 'Loki', year: 2021, season: 2, episode: 1 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(decoder.decrypt).toHaveBeenCalledTimes(3);
    expect((services.request as jest.Mock).mock.calls.filter(([request]: [ExtractionRequest]) => request.url.pathname === '/generate.php')).toHaveLength(3);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://media.vidsrcme.test/fixture-encrypted-movie/backup.m3u8?token=fixture-token') }), expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://data.vidsrcme.ru/api.php?type=tv&tmdb=1396&season=1&episode=1&stream_urls=') }), expect.any(AbortSignal));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://data.vidsrcme.ru/api.php?type=tv&tmdb=84958&season=2&episode=1&stream_urls=') }), expect.any(AbortSignal));
  });
});
