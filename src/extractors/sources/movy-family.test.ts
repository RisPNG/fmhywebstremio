import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { MovyFamily } from './movy-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/movy/${name}`), 'utf8');
const sourcesFixture = (tmdbId: string | null) => JSON.parse(fixture(tmdbId === '550' ? 'sources-fight-club.json' : 'sources-game-of-thrones-s01e01.json')) as { seed: string; payload: string };
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), durationMs: 0 } } as unknown as ExtractionResponse);
const failure = (code: 'HTTP_NOT_FOUND' | 'HTTP_SERVER_ERROR', url: URL) => new TransportFailure({ code, message: code, stage: 'stage:transport', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, finalUrl: url.href } } as never);

describe('Movy source family', () => {
  const source: SourceRecord = { id: 'movy:www.movy.sx', canonicalDomain: 'www.movy.sx', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:550', type: 'movie', tmdbId: 550, imdbId: 'tt0137523', title: 'Fight Club', year: 1999 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1399:1:1', type: 'episode', tmdbId: 1399, imdbId: 'tt0944947', title: 'Game of Thrones', year: 2011, season: 1, episode: 1 };
  const signal = new AbortController().signal;
  const servicesFor = (overrides: Readonly<Record<string, string | TransportFailure>> = {}): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const { pathname, searchParams } = request.url;
    const key = pathname === '/seed' ? 'seed' : pathname === '/miami/sources' ? 'sources' : pathname;
    const defaults: Readonly<Record<string, string>> = {
      '/movie/550': fixture('movie-fight-club.html'),
      '/tv/1399': fixture('tv-game-of-thrones.html'),
      seed: JSON.stringify({ seed: sourcesFixture(searchParams.get('mediaId')).seed, ttlMs: 30000 }),
      sources: sourcesFixture(searchParams.get('tmdbId')).payload,
    };
    const body = overrides[key] ?? defaults[key] ?? failure('HTTP_NOT_FOUND', request.url);
    if (body instanceof TransportFailure) throw body;
    return response(request.url, body);
  }) });
  const requested = (services: RequestServices) => (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);

  test('requires the declared Movy identity and Next.js client assets', () => {
    const family = new MovyFamily();
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://www.movy.sx/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'movy', confidence: 1 });
    for (const altered of [html.replace('content="Movy"', 'content="Other"'), html.replace('id="__NEXT_DATA__"', 'id="data"'), html.replace('/_next/static/chunks/', '/static/')]) expect(family.classify(source, { ...snapshot, htmlSample: altered })).toBeNull();
  });

  test('decrypts the seeded sources payload into a relayed HLS master playlist for a movie', async () => {
    const services = servicesFor();
    const result = await new MovyFamily().discoverMedia(movie, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Movy streams');
    expect(result.streams).toHaveLength(1);
    expect(result.streams[0]?.url.pathname.endsWith('/master.m3u8')).toBe(true);
    expect(result.streams.every(stream => stream.protocol === 'hls' && stream.delivery === 'relayed' && stream.hostExtractor === 'miami-api' && stream.sourceId === source.id && stream.sourceExtractor === 'movy')).toBe(true);
    expect(result.streams[0]?.headers).toEqual({ origin: 'https://www.movy.sx', referer: 'https://www.movy.sx/' });
    expect(result.streams[0]?.url.hostname).toBe('moon.goldenkite.top');
    const calls = requested(services);
    expect(calls.map(request => request.url.pathname)).toEqual(['/movie/550', '/seed', '/miami/sources']);
    expect(calls[2]?.url.searchParams.get('seed')).toBe(sourcesFixture('550').seed);
    expect(calls[2]?.url.searchParams.get('mediaType')).toBe('movie');
    expect(calls[2]?.headers).toEqual({ origin: 'https://www.movy.sx', referer: 'https://www.movy.sx/' });
  });

  test('asks for the requested season and episode of a series', async () => {
    const services = servicesFor();
    const result = await new MovyFamily().discoverMedia(episode, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected Movy episode streams');
    expect(result.streams.length).toBeGreaterThan(0);
    const query = requested(services).at(-1)?.url.searchParams;
    expect([query?.get('mediaType'), query?.get('seasonId'), query?.get('episodeId'), query?.get('tmdbId')]).toEqual(['tv', '1', '1', '1399']);
  });

  test('keeps absent or mismatched titles from reaching the stream API', async () => {
    for (const media of [{ ...movie, title: 'Another Title' }, { ...movie, tmdbId: 2147483647 }, { ...episode, season: 0 }, { canonicalId: 'tmdb:550', type: 'movie' as const, tmdbId: 550, title: 'Fight Club', year: 1999 }]) {
      const services = servicesFor();
      await expect(new MovyFamily().discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      expect(requested(services).some(request => request.url.pathname === '/seed')).toBe(false);
    }
  });

  test('treats a server error from the sources endpoint as no streams', async () => {
    await expect(new MovyFamily().discoverMedia(movie, source, servicesFor({ sources: failure('HTTP_SERVER_ERROR', new URL('https://api.wecollege.net/miami/sources')) }), signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('reports a changed seed or payload contract', async () => {
    const family = new MovyFamily();
    for (const overrides of [{ seed: '{}' }, { sources: 'not-a-valid-payload' }]) {
      const result = await family.discoverMedia(movie, source, servicesFor(overrides), signal);
      expect(result).toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', familyId: 'movy' } });
    }
  });
});
