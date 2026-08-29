import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import CinextreamHostExtractor, { type CinextreamEnvelopeDecoder, WasmCinextreamEnvelopeDecoder } from '../hosts/cinextream-host-extractor';
import { CinetaroFamily } from './cinetaro-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cinetaro/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Cinetaro source family and Cinextream host architecture', () => {
  const source: SourceRecord = { id: 'cinetaro:cinetaro.test', canonicalDomain: 'cinetaro.test', aliases: [], fmhy: { section: 'Stream Aggregators', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'cinetaro', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the Cinetaro catalog without matching the CineGo player family', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cinetaro.test/'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new CinetaroFamily().classify(source, snapshot)).toMatchObject({ familyId: 'cinetaro', confidence: 1, evidence: [{ fingerprint: 'cinetaro-search' }, { value: 'cinetaro-catalog-routes' }, { fingerprint: 'cinetaro-brand' }] });
  });

  test('derives the requested-title key and decrypts the host envelope through the declared WASM interface', async () => {
    const memory = { buffer: new ArrayBuffer(4096) };
    const plaintext = fixture('decrypted-kuro.json');
    let allocated = 64;
    const webAssembly = (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly;
    (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = { instantiate: async () => ({ instance: { exports: { memory, allocBuffer: (size: number) => {
      const pointer = allocated;
      allocated += size;
      return pointer;
    }, freeBuffer: () => undefined, normalizeBuffer: (_encryptedPointer: number, _encryptedLength: number, keyPointer: number, outputPointer: number) => {
      expect(Buffer.from(new Uint8Array(memory.buffer, keyPointer, 32)).toString('hex')).toBe('7b4ec1141dce84ad00abd2d567b80c4c1d734926897c726529893739795887cf');
      new Uint8Array(memory.buffer, outputPointer, Buffer.byteLength(plaintext)).set(Buffer.from(plaintext));
      return Buffer.byteLength(plaintext);
    } } } }) };
    const services: RequestServices = { request: jest.fn(async request => response(request.url.href, 'fixture', 'application/wasm')) };
    await expect(new WasmCinextreamEnvelopeDecoder().decrypt('Zml4dHVyZQ==', 27205, 'fixture-salt', new URL('https://cinextream.test/decrypt.wasm'), services, new AbortController().signal)).resolves.toEqual(JSON.parse(plaintext));
    (globalThis as typeof globalThis & { WebAssembly: unknown }).WebAssembly = webAssembly;
  });

  test('matches exact movie and series catalog entries, preserves later-season coordinates, and validates playback', async () => {
    const decoder: CinextreamEnvelopeDecoder = { decrypt: jest.fn(async () => JSON.parse(fixture('decrypted-kuro.json')) as unknown) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/ajax/search/suggest') {
        if (request.url.searchParams.get('keyword') === 'Inception') return response(request.url.href, fixture('search-inception.json'));
        if (request.url.searchParams.get('keyword') === 'Breaking Bad') return response(request.url.href, fixture('search-breaking-bad.json'));
        return response(request.url.href, fixture('search-absent.json'));
      }
      if (request.url.pathname === '/watch/27205') return response(request.url.href, fixture('watch-movie.html'), 'text/html');
      if (request.url.pathname === '/watch/1396') return response(request.url.href, fixture(request.url.searchParams.get('s') === '5' ? 'watch-s05.html' : 'watch-s01.html'), 'text/html');
      if (request.url.pathname === '/src/ajax/anime/server.php') return response(request.url.href, fixture('servers.json'));
      if (request.url.pathname === '/src/player/sub.php') return response(request.url.href, fixture(request.url.searchParams.get('id') === '1396-5-16' ? 'player-s05.html' : request.url.searchParams.get('id') === '1396-1-1' ? 'player-s01.html' : 'player-movie.html'), 'text/html');
      if (request.url.hostname === 'cinextream.cc' && request.url.pathname.startsWith('/api/embed/')) return response(request.url.href, fixture('embed.html'), 'text/html');
      if (request.url.pathname === '/api/proxy') return response(request.url.href, fixture('encrypted.json'));
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      return response(request.url.href, fixture(request.url.pathname.endsWith('video_main.m3u8') ? 'media.m3u8' : 'master.m3u8'), 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const family = new CinetaroFamily();
    const resolver = new ExtractionResolver(new StaticExtractorLookup([new CinextreamHostExtractor(decoder)]), services);
    const outcome = await new FamilyHealthRunner(resolver, new StreamSelector(services), services, registry).run(source, family, { familyId: 'cinetaro', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true }, anomalies: [] });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://cinetaro.test/src/player/sub.php?id=1396-5-16&server=maple&embed=true&ep=16') }), expect.any(AbortSignal));
    expect(decoder.decrypt).toHaveBeenCalledTimes(3);
  });
});
