import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as cheerio from 'cheerio';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner, type SourceProbeSnapshot } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import type { VidsparkHostArchitecture } from '../hosts/vidspark-host-architecture';
import { PressPlayXFamily } from './pressplayx-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/pressplayx/${name}`), 'utf8');
const response = (url: string, body: string, contentType = 'text/html'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('PressPlayX source family with its VidSpark player', () => {
  const source: SourceRecord = { id: 'pressplayx:pressplayx.to', canonicalDomain: 'pressplayx.to', aliases: [], fmhy: { section: 'Dedicated-Server', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'pressplayx', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
  const site = (request: ExtractionRequest) => {
    if (request.url.pathname === '/explore') return response(request.url.href, fixture(request.url.searchParams.get('q') === 'Inception' ? 'explore-inception.html' : request.url.searchParams.get('q') === 'Breaking Bad' ? 'explore-breaking-bad.html' : 'explore-absent.html'));
    if (request.url.pathname === '/watch/movie-inception-lbx9i') return response(request.url.href, fixture('watch-unavailable.html'));
    if (request.url.pathname === '/watch/movie-inception-gyan6') return response(request.url.href, fixture('watch.html').replace('{player-path}', 'movie/27205'));
    if (request.url.pathname === '/watch/tv-breaking-bad-3mk8u') return response(request.url.href, fixture('watch.html').replace('{player-path}', `tv/1396-${request.url.searchParams.get('season') ?? 1}-${request.url.searchParams.get('episode') ?? 1}`));
    throw new Error(`Unexpected request ${request.url.href}`);
  };

  test('recognizes the PressPlayX catalog client', () => {
    const html = fixture('home.html');
    const $ = cheerio.load(html);
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://pressplayx.to/'), status: 200, headers: {}, htmlSample: html, assetPaths: $('script[src]').map((_index, element) => $(element).attr('src')).get(), scriptSignatures: [], routeHints: [] };
    expect(new PressPlayXFamily().classify(source, snapshot)).toMatchObject({ familyId: 'pressplayx', confidence: 1, evidence: [{ fingerprint: 'pressplayx-brand' }, { value: 'pressplayx-astro' }, { value: 'pressplayx-watch-slug' }] });
  });

  test('matches exact catalog titles and forwards the watch page player for the requested episode', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn(async (media, _player, sourceId, sourceExtractor): Promise<ExtractionResult> => ({ type: 'streams', streams: [{ url: new URL(`https://media.test/${media.type === 'movie' ? 'movie' : `s${media.season}e${media.episode}`}/master.m3u8`), protocol: 'hls', sourceId, sourceExtractor, hostExtractor: 'vidspark-api', discoveredAt: new Date(0) }] })) };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => {
      if (request.url.hostname === source.canonicalDomain) return site(request);
      if (request.expectedContent === 'binary') return response(request.url.href, 'fixture-segment', 'video/mp2t');
      if (/\/video\.m3u8$/.test(request.url.pathname)) return response(request.url.href, '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST', 'application/vnd.apple.mpegurl');
      return response(request.url.href, '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.64001f"\nvideo.m3u8', 'application/vnd.apple.mpegurl');
    }) };
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new PressPlayXFamily(host), { familyId: 'pressplayx', cases: [
      { id: 'movie', media: { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, expected: 'discoverable' },
      { id: 'episode', media: { canonicalId: 'tmdb:1396:1:1', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, expected: 'discoverable' },
      { id: 'later-season', media: { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, expected: 'discoverable' },
      { id: 'absent', media: { canonicalId: 'probe:absent', type: 'movie', tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true } });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id, status: 'supported' }]);
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 27205 }), new URL('https://moviesapi.to/movie/27205?theme=F7BD46'), source.id, 'pressplayx', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledWith(expect.objectContaining({ tmdbId: 1396, season: 5, episode: 16 }), new URL('https://moviesapi.to/tv/1396-5-16?theme=F7BD46'), source.id, 'pressplayx', services, expect.any(AbortSignal));
    expect(host.discover).toHaveBeenCalledTimes(3);
    expect((services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request.url.pathname)).not.toContain('/watch/movie-breaking-bad-wolf-8vrrr');
  });

  test('does not delegate a watch page whose player belongs to a different TMDB title', async () => {
    const host: VidsparkHostArchitecture = { discover: jest.fn() };
    const services: RequestServices = { request: jest.fn(async (request: ExtractionRequest) => request.url.pathname === '/watch/movie-inception-gyan6' ? response(request.url.href, fixture('watch.html').replace('{player-path}', 'movie/64956')) : site(request)) };
    await expect(new PressPlayXFamily(host).discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });
});
