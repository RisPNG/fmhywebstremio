import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import type { BingeBangHostArchitecture } from '../hosts/bingebang-host-architecture';
import { BingeBangFamily } from './bingebang-family';

describe('BingeBang source family', () => {
  const source: SourceRecord = { id: 'bingebang:bingebang.test', canonicalDomain: 'bingebang.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const html = readFileSync(resolve(__dirname, '../__fixtures__/bingebang/home.html'), 'utf8');
  const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://bingebang.test/'), status: 200, headers: {}, htmlSample: html, assetPaths: ['/assets/js/app.bundle.min.js', '/assets/css/style.css'], scriptSignatures: [], routeHints: ['/explore', '/movie/watch/inception-2010-uyknsn', '/movies', '/tv/watch/the-boys-azkuo5'] };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
  const series: MediaIdentity = { canonicalId: 'tmdb:76479:2:1', type: 'episode', tmdbId: 76479, imdbId: 'tt1190634', title: 'The Boys', year: 2019, season: 2, episode: 1 };

  test('requires the client bundle, explore search action, and catalog routes together', () => {
    const family = new BingeBangFamily();
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: family.id, confidence: 1 });
    expect(family.classify(source, { ...snapshot, htmlSample: html.replace('/assets/js/app.bundle.min.js', '/assets/js/other.js') })).toBeNull();
    expect(family.classify(source, { ...snapshot, htmlSample: html.replace('/explore?q={search_term_string}', '/search?q={search_term_string}') })).toBeNull();
    expect(family.classify(source, { ...snapshot, routeHints: ['/explore', '/movies'] })).toBeNull();
  });

  test('matches the exact catalog entry and sends the requested later season to the player architecture', async () => {
    const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.test/master.m3u8'), protocol: 'hls', delivery: 'relayed', sourceId: source.id, sourceExtractor: 'bingebang', hostExtractor: 'bingebang-player', discoveredAt: new Date(0) }] };
    const host: BingeBangHostArchitecture = { discover: jest.fn(async () => streams) };
    const family = new BingeBangFamily(host);
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      const query = request.url.searchParams.get('query');
      const body = readFileSync(resolve(__dirname, `../__fixtures__/bingebang/${query === 'Inception' ? 'search-inception.json' : query === 'The Boys' ? 'search-the-boys.json' : 'search-absent.json'}`), 'utf8');
      return { status: 200, headers: {}, finalUrl: request.url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
    }) };
    for (const media of [movie, series]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(1, new URL('https://bingebang.test/movie/play/inception-2010-uyknsn'), movie, source.id, family.id, services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenNthCalledWith(2, new URL('https://bingebang.test/tv/play/the-boys-azkuo5'), series, source.id, family.id, services, expect.any(AbortSignal));
    const catalog = JSON.parse(readFileSync(resolve(__dirname, '../__fixtures__/bingebang/search-the-boys.json'), 'utf8')) as { results: { year: number }[] };
    expect(catalog.results[0]?.year).toBe(series.year);
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 1, year: 1874 }, { ...movie, year: 1980 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }, { ...series, season: 6 }, { ...series, type: 'movie' as const }]) await expect(family.discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).toHaveBeenCalledTimes(2);
  });

  test('preserves a typed failure for a changed search response', async () => {
    const host: BingeBangHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => ({ status: 200, headers: { 'content-type': 'application/json' }, finalUrl: request.url, redirectChain: [], body: Buffer.from('{}'), text: () => '{}', json: () => ({}), truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } })) };
    await expect(new BingeBangFamily(host).discoverMedia(movie, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', stage: 'stage:discovery', sourceId: source.id, familyId: 'bingebang', diagnostic: { parserPath: 'results' } } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
