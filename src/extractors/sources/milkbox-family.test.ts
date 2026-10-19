import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import { defaultFamilyHealthCorpora, FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { TransportFailure } from '../../engine/transport/transport-director';
import type { VidsparkHostArchitecture } from '../hosts/vidspark-host-architecture';
import { MilkBoxFamily } from './milkbox-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/milkbox/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'text/html'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('MilkBox source family with its configured VidSpark player', () => {
  const source: SourceRecord = { id: 'milkbox:milkbox.zapto.org', canonicalDomain: 'milkbox.zapto.org', aliases: [], fmhy: { section: 'Multi-Server', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'milkbox', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
  const movie = { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode = { canonicalId: 'tmdb:1396:5:16', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const site = (request: ExtractionRequest) => {
    if (request.url.pathname === '/') return response(request.url.href, fixture('home.html'));
    if (request.url.pathname === '/app.js') return response(request.url.href, fixture('client.txt'), 'text/javascript');
    if (request.url.pathname === '/api/tmdb/search/multi') return response(request.url.href, fixture(request.url.searchParams.get('query') === 'Inception' ? 'search-inception.json' : request.url.searchParams.get('query') === 'Breaking Bad' ? 'search-breaking-bad.json' : 'search-absent.json'), 'application/json');
    if (request.url.pathname === '/api/tmdb/tv/1396/season/1') return response(request.url.href, fixture('season-breaking-bad-1.json'), 'application/json');
    if (request.url.pathname === '/api/tmdb/tv/1396/season/5') return response(request.url.href, fixture('season-breaking-bad-5.json'), 'application/json');
    throw new Error(`Unexpected request ${request.url.href}`);
  };

  test('recognizes the catalog, server selector, and current application asset together', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://milkbox.zapto.org/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new MilkBoxFamily().classify(source, snapshot)).toMatchObject({ familyId: 'milkbox', confidence: 1 });
    expect(new MilkBoxFamily().classify(source, { ...snapshot, htmlSample: html.replace('value="vidspark"', 'value="other"') })).toBeNull();
  });

  test('validates its movie, premiere, later-season, and absent health corpus through the source catalog', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn(async (media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}.mp4`), protocol: 'http', delivery: 'relayed', headers: { referer: 'https://vidspark.to/' }, sourceId, sourceExtractor, hostExtractor: 'vidspark-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.hostname === source.canonicalDomain ? site(request) : response(request.url.href, '', 'video/mp4')) };
    const registry = new SourceRegistry();
    registry.set(source);
    const corpus = defaultFamilyHealthCorpora.get('milkbox');
    if (!corpus) throw new Error('Expected MilkBox health corpus');
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new MilkBoxFamily(host), corpus, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 27205 }), new URL('https://vidspark.to/movie/27205'), source.id, 'milkbox', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, season: 1, episode: 1 }), new URL('https://vidspark.to/tv/1396/1/1'), source.id, 'milkbox', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, season: 5, episode: 16 }), new URL('https://vidspark.to/tv/1396/5/16'), source.id, 'milkbox', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
    expect((services.request as jest.Mock).mock.calls.filter(([request]: [ExtractionRequest]) => request.url.pathname === '/api/tmdb/search/multi').every(([request]: [ExtractionRequest]) => request.url.searchParams.get('language') === 'en-US' && request.url.searchParams.get('page') === '1')).toBe(true);
  });

  test.each([
    { id: 1359046, title: 'Inception', media_type: 'movie', release_date: '2010-07-15' },
    { id: 27205, title: 'Inception: The Cobol Job', media_type: 'movie', release_date: '2010-07-15' },
    { id: 27205, name: 'Inception', media_type: 'tv', release_date: '2010-07-15' },
    { id: 27205, title: 'Inception', media_type: 'movie', release_date: '1980-01-23' },
  ])('does not delegate a nearby catalog result: %j', async (result) => {
    const host: VidsparkHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === '/api/tmdb/search/multi' ? response(request.url.href, JSON.stringify({ results: [result] }), 'application/json') : site(request)) };
    await expect(new MilkBoxFamily(host).discoverMedia(movie, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('rejects a missing episode without opening the configured player', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => site(request)) };
    await expect(new MilkBoxFamily(host).discoverMedia({ ...episode, episode: 17 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('treats a nonexistent season as absent', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/api/tmdb/tv/1396/season/6') throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'Not found', stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      return site(request);
    }) };
    await expect(new MilkBoxFamily(host).discoverMedia({ ...episode, season: 6 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('follows the player origin configured by the current source client', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn(async (): Promise<ExtractionResult> => ({ type: 'empty', reason: 'no-streams' })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === '/app.js' ? response(request.url.href, fixture('client.txt').replaceAll('https://vidspark.to/', 'https://configured.test/'), 'text/javascript') : site(request)) };
    await new MilkBoxFamily(host).discoverMedia(episode, source, services, new AbortController().signal);
    expect(host.discover).toHaveBeenCalledWith(episode, new URL('https://configured.test/tv/1396/5/16'), source.id, 'milkbox', services, expect.any(AbortSignal));
  });

  test('reports changed catalog responses instead of claiming a title is absent', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === '/api/tmdb/search/multi' ? response(request.url.href, '{}', 'application/json') : site(request)) };
    await expect(new MilkBoxFamily(host).discoverMedia(movie, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED' } });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
