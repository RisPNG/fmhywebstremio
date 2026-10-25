import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { MovieNerdsFamily } from './movienerds-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/movienerds/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('MovieNerds source family', () => {
  const source: SourceRecord = { id: 'movienerds:movienerds.site', canonicalDomain: 'movienerds.site', aliases: ['vidflix.live', 'movieplex.online'], fmhy: { section: 'Stream Aggregators', tags: [], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const signal = new AbortController().signal;
  const servicesFor = (client: string, streams: (request: ExtractionRequest) => string): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => response(request.url, request.url.pathname === '/' ? fixture('home.html') : request.url.pathname.startsWith('/assets/') ? client : streams(request))) });

  test('recognizes the MovieNerds client fingerprint', () => {
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://movienerds.site/'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new MovieNerdsFamily().classify(source, snapshot)).toMatchObject({ familyId: 'movienerds', confidence: 1 });
    expect(new MovieNerdsFamily().classify(source, { ...snapshot, htmlSample: fixture('home.html').replace('<title>MovieNerds', '<title>VidFlix') })).toBeNull();
  });

  test('requests the configured stream API and publishes every direct HLS source for the exact media', async () => {
    const services = servicesFor(fixture('client.txt'), request => fixture(request.url.searchParams.get('tmdbId') === '27205' ? 'stream-inception.json' : 'stream-breaking-bad-s05e16.json'));
    const family = new MovieNerdsFamily();
    const movie = await family.discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, imdbId: 'tt1375666', title: 'Inception', year: 2010 }, source, services, signal);
    expect(movie).toMatchObject({ type: 'streams', streams: [
      { protocol: 'hls', delivery: 'relayed', label: '720p HD', declaredResolution: { width: 1280, height: 720 }, subtitles: [{ url: new URL('https://api.movienerds.online/api/subtitles/vtt?url=https%3A%2F%2Fdl.opensubtitles.org%2Fen%2Fdownload%2Fsrc-api%2Fvrf-19c10c5b%2Ffile%2F1952382875.gz'), label: 'English', language: 'eng' }, { label: 'Spanish' }], sourceId: source.id, sourceExtractor: 'movienerds' },
      { url: new URL('https://s5.phim1280.tv/20240911/qTL6xlyr/index.m3u8'), label: '1080p FHD', declaredResolution: { width: 1920, height: 1080 } },
    ] });
    const [, , streamRequest] = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(streamRequest?.url.href).toBe('https://api.movienerds.online/api/stream?tmdbId=27205&type=movie&lang=en&title=Inception&year=2010&imdbId=tt1375666');
    expect(streamRequest?.headers).toEqual({ 'Accept': 'application/json', 'x-client-app': 'movienerds', 'x-app-key': 'mn_sec_2026_stream_auth' });
    const episode = await family.discoverMedia({ canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 }, source, services, signal);
    expect(episode).toMatchObject({ type: 'streams', streams: [{ protocol: 'hls', delivery: 'relayed', url: expect.objectContaining({ hostname: 'api.movienerds.online' }) }] });
    expect((services.request as jest.Mock).mock.calls.at(-1)?.[0].url.searchParams.toString()).toBe('tmdbId=1396&type=tv&lang=en&title=Breaking+Bad&year=2008&season=5&episode=16');
  });

  test('treats mismatched identities and embed-only results as absent', async () => {
    const family = new MovieNerdsFamily();
    const services = servicesFor(fixture('client.txt'), request => request.url.searchParams.get('tmdbId') === '1' ? fixture('stream-absent.json') : fixture(request.url.searchParams.get('tmdbId') === '27205' ? 'stream-inception.json' : 'stream-breaking-bad-s05e16.json'));
    for (const media of [
      { canonicalId: 'probe:absent', type: 'movie' as const, tmdbId: 1, title: 'FMHY Extractability Probe 7b18e49a', year: 1874 },
      { canonicalId: 'wrong-year', type: 'movie' as const, tmdbId: 27205, title: 'Inception', year: 1980 },
      { canonicalId: 'wrong-episode', type: 'episode' as const, tmdbId: 1396, title: 'Breaking Bad', season: 5, episode: 15 },
    ]) await expect(family.discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    const embedsOnly = servicesFor(fixture('client.txt'), () => JSON.stringify({ ...JSON.parse(fixture('stream-absent.json')) as object, tmdbId: 27205, type: 'movie', title: 'Inception', year: 2010 }));
    await expect(family.discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, embedsOnly, signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('reports a client that no longer declares its stream API', async () => {
    const services = servicesFor(fixture('client.txt').replace('"x-app-key"', '"x-session"'), () => fixture('stream-inception.json'));
    await expect(new MovieNerdsFamily().discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', stage: 'stage:discovery' } });
    expect(services.request).toHaveBeenCalledTimes(2);
  });

  test('rejects the native client junk sources while preserving valid HLS siblings', async () => {
    const payload = JSON.parse(fixture('stream-inception.json')) as { sources: Record<string, unknown>[] };
    const valid = payload.sources.map(stream => stream['url']);
    payload.sources.push(
      { url: 'https://media.test/sample/master.m3u8', type: 'hls', isDirect: true },
      { url: 'https://media.test/TRAILER/master.m3u8', type: 'hls', isDirect: true },
      { url: 'https://api.movienerds.online/api/stream/proxy.m3u8?b64=opaque-reference', rawUrl: 'https%3A%2F%2Fmedia.test%2F%70%72%6f%6d%6f%2Fmaster.m3u8', type: 'hls', isDirect: true },
      { url: 'https://api.movienerds.online/api/stream/proxy.m3u8?b64=blocked-host', rawUrl: 'https://staticreverie.site/full.m3u8', type: 'hls', isDirect: true },
      { url: 'https://media.test/UNAVAILABLE/index.m3u8', type: 'hls', isDirect: true },
      { url: 'ftp://media.test/full.m3u8', type: 'hls', isDirect: true },
    );
    const services = servicesFor(fixture('client.txt'), () => JSON.stringify(payload));
    const result = await new MovieNerdsFamily().discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected valid MovieNerds streams');
    expect(result.streams.map(stream => stream.url.href)).toEqual(valid);
  });

  test('matches the native malformed-escape behavior without discarding valid siblings', async () => {
    const payload = JSON.parse(fixture('stream-inception.json')) as { sources: Record<string, unknown>[] };
    payload.sources = [
      { url: 'https://media.test/release%zz/master.m3u8', type: 'hls', isDirect: true },
      { url: 'https://media.test/sample%zz/master.m3u8', type: 'hls', isDirect: true },
      { url: 'https://media.test/proxy.m3u8?b64=malformed', rawUrl: 'https://media.test/%73%61%6d%70%6c%65/%zz/master.m3u8', type: 'hls', isDirect: true },
    ];
    const services = servicesFor(fixture('client.txt'), () => JSON.stringify(payload));
    const result = await new MovieNerdsFamily().discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 }, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected valid MovieNerds streams');
    expect(result.streams.map(stream => stream.url.href)).toEqual(['https://media.test/release%zz/master.m3u8', 'https://media.test/proxy.m3u8?b64=malformed']);
  });
});
