import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import type { VidsrcMeHostArchitecture } from '../hosts/vidsrcme-host-architecture';
import { SixtySevenMoviesFamily } from './sixty-seven-movies-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/sixty-seven-movies/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('67Movies source family with the shared VidsrcMe host architecture', () => {
  const source: SourceRecord = { id: '67movies:67movies.net', canonicalDomain: '67movies.nl', aliases: ['67movies.net', 'phantomflix.net', 'ravenflix.net', 'shows.st'], fmhy: { section: 'Stream Aggregators', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'sixty-seven-movies', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };

  test('recognizes the shared catalog client fingerprint', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://67movies.nl/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new SixtySevenMoviesFamily().classify(source, snapshot)).toMatchObject({ familyId: 'sixty-seven-movies', confidence: 1, evidence: [{ fingerprint: 'sixty-seven-movies-brand' }, { value: 'sixty-seven-movies-catalog' }, { value: 'sixty-seven-movies-next-client' }] });
  });

  test('matches exact movie and series catalog entries and forwards later-season playback identity', async () => {
    const host: VidsrcMeHostArchitecture = { discover: jest.fn(async (media, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}/master.m3u8`), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'vidsrcme-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.pathname === '/api/semantic-search') {
        if (request.url.searchParams.get('q') === 'Inception') return response(request.url.href, fixture('search-inception.json'));
        if (request.url.searchParams.get('q') === 'Breaking Bad') return response(request.url.href, fixture('search-breaking-bad.json'));
        return response(request.url.href, fixture('search-absent.json'));
      }
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      if (/\/video\.m3u8$/.test(request.url.pathname)) return response(request.url.href, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl');
      return response(request.url.href, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\nvideo.m3u8', 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new SixtySevenMoviesFamily(host), { familyId: 'sixty-seven-movies', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, year: 2008, season: 5, episode: 16 }), source.id, 'sixty-seven-movies', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
  });
});
