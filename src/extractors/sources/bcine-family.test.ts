import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { TransportFailure } from '../../engine/transport/transport-director';
import { OneEmbedApiHostArchitecture, type OneEmbedHostArchitecture } from '../hosts/oneembed-host-architecture';
import { BcineFamily } from './bcine-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/bcine/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('BCine source family with the shared 1Embed host architecture', () => {
  const source: SourceRecord = { id: 'bcine:bcine.ru', canonicalDomain: 'bcine.ru', aliases: [], fmhy: { section: 'Stream Aggregators', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'bcine', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the BCine catalog fingerprint', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://bcine.ru/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('[src],[href]').map((_index, element) => $(element).attr('src') ?? $(element).attr('href')).get(), scriptSignatures: [], routeHints: $('a[href]').map((_index, element) => $(element).attr('href')).get() };
    expect(new BcineFamily().classify(source, snapshot)).toMatchObject({ familyId: 'bcine', confidence: 1, evidence: [{ fingerprint: 'bcine-brand' }, { value: '/movie|tv/{tmdbId}' }, { value: 'bcine-next-client' }] });
  });

  test('exchanges the 1Embed challenge and returns only the intended real stream', async () => {
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === '/api/token'
      ? response(request.url.href, fixture('oneembed-token.json'))
      : response(request.url.href, fixture('oneembed-source.json'))) };
    const media = { canonicalId: 'tmdb:27205', type: 'movie' as const, tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 };
    const result = await new OneEmbedApiHostArchitecture().discover(media, source.id, 'bcine', services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: [
      { url: new URL('https://media.bcine.test/master.m3u8'), headers: { referer: 'https://player.bcine.test/', origin: 'https://player.bcine.test' }, protocol: 'hls', label: 'BORE', declaredResolution: { width: 1920, height: 1080 }, sourceId: source.id, sourceExtractor: 'bcine', hostExtractor: 'oneembed-api' },
      { url: new URL('https://proxy.bcine.test/v?url=https%3A%2F%2Fmedia.bcine.test%2Fmaster.m3u8&referer=https%3A%2F%2Fplayer.bcine.test%2F&origin=https%3A%2F%2Fplayer.bcine.test') },
    ] });
    expect(services.request).toHaveBeenNthCalledWith(2, expect.objectContaining({ url: new URL('https://1embed.cc/api/sources/4/id=27205?type=movie&title=Inception'), headers: { 'X-Stream-Token': expect.any(String) } }), expect.any(AbortSignal));
    const request = (services.request as jest.Mock).mock.calls[1]?.[0] as ExtractionRequest;
    const token = JSON.parse(Buffer.from(request.headers?.['X-Stream-Token'] ?? '', 'base64').toString()) as { t: number; n: number; s: string; p: string };
    expect(token).toEqual({ t: 1788179686591, n: 1658595859, s: 'bdcd06794210f3aa5c03c1e64b43444ff386ed8db42ce739014372cfa3f89fd2', p: '134db38d6d1d238c' });
  });

  test('matches exact movies and series while preserving later-season playback coordinates', async () => {
    const host: OneEmbedHostArchitecture = { discover: jest.fn(async (media, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.bcine.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}/master.m3u8`), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'oneembed-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === source.canonicalDomain) {
        if (request.url.pathname === '/movie/27205') return response(request.url.href, fixture('movie-inception.html'), 'text/html');
        if (request.url.pathname === '/tv/1396') return response(request.url.href, fixture('series-breaking-bad.html'), 'text/html');
        throw new TransportFailure({ code: 'HTTP_NOT_FOUND', message: 'HTTP request failed with status 404', stage: 'stage:transport', targetHost: source.canonicalDomain, observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', status: 404, bodyCaptured: false } });
      }
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      if (/\/video\.m3u8$/.test(request.url.pathname)) return response(request.url.href, fixture('media.m3u8'), 'application/vnd.apple.mpegurl');
      return response(request.url.href, fixture('master.m3u8'), 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new BcineFamily(host), { familyId: 'bcine', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, year: 2008, season: 5, episode: 16 }), source.id, 'bcine', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
  });
});
