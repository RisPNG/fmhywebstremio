import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { CineruvFamily } from './cineruv-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/cineruv/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('Cineruv source family', () => {
  const source: SourceRecord = { id: 'cineruv:cineruv.website', canonicalDomain: 'cineruv.website', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:27205', type: 'movie', tmdbId: 27205, title: 'Inception', year: 2010 };
  const episode: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const signal = new AbortController().signal;
  const servicesFor = (overrides: Readonly<Record<string, string>> = {}): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const path = request.url.pathname;
    let name: string;
    if (path === '/') name = 'home.html';
    else if (path.startsWith('/assets/')) name = 'client.txt';
    else if (path === '/api/media/search') name = request.url.searchParams.get('q') === 'Inception' ? 'search-inception.json' : request.url.searchParams.get('q') === 'Breaking Bad' ? 'search-breaking-bad.json' : 'search-absent.json';
    else if (path === '/api/media/movie/27205') name = 'movie-inception.json';
    else if (path === '/api/media/tv/1396') name = 'tv-breaking-bad.json';
    else if (path.startsWith('/api/media/tv/1396/season/')) name = `season-breaking-bad-${path.split('/').at(-1)}.json`;
    else if (path === '/api/stream') name = request.url.searchParams.get('type') === 'movie' ? 'stream-inception.json' : request.url.searchParams.get('season') === '1' ? 'stream-breaking-bad-s01e01.json' : 'stream-breaking-bad-s05e16.json';
    else throw new Error(`Unexpected Cineruv request: ${path}`);
    return response(request.url, overrides[name] ?? fixture(name));
  }) });

  test('requires the declared Cineruv identity and application assets', () => {
    const family = new CineruvFamily();
    const html = fixture('home.html');
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://cineruv.website/'), status: 200, headers: {}, htmlSample: html, assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'cineruv', confidence: 1 });
    for (const altered of [html.replace('<title>cineruv</title>', '<title>Other</title>'), html.replace('property="og:site_name"', 'property="og:other"'), html.replace('id="root"', 'id="app"')]) expect(family.classify(source, { ...snapshot, htmlSample: altered })).toBeNull();
  });

  test('uses the configured API and exact catalog before returning native referrer-bound HLS resources', async () => {
    const family = new CineruvFamily();
    const services = servicesFor();
    const result = await family.discoverMedia(movie, source, services, signal);
    if (result.type !== 'streams') throw new Error('Expected native Cineruv streams');
    expect(result.streams).toHaveLength(3);
    expect(result.streams.every(stream => stream.url.hostname === 'api.movenerds.space' && stream.url.pathname === '/api/proxy/master.m3u8')).toBe(true);
    expect(result.streams[0]).toMatchObject({ protocol: 'hls', delivery: 'relayed', headers: { origin: 'https://cineruv.website', referer: 'https://cineruv.website/' }, sourceId: source.id, sourceExtractor: 'cineruv' });
    expect(result.streams[0]?.declaredResolution).toBeUndefined();
    const requests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.map(request => request.url.pathname)).toEqual(['/', '/assets/index-B7gh400w.js', '/api/media/search', '/api/media/movie/27205', '/api/stream']);
    expect(requests.at(-1)?.url.href).toBe('https://api.movenerds.space/api/stream?tmdbId=27205&type=movie&title=Inception&year=2010&language=en');
  });

  test('verifies the requested later-season episode without comparing its release year with the premiere', async () => {
    const first = servicesFor();
    await expect(new CineruvFamily().discoverMedia({ ...episode, season: 1, episode: 1 }, source, first, signal)).resolves.toMatchObject({ type: 'streams' });
    expect((first.request as jest.Mock).mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname === '/api/media/tv/1396/season/1')).toBe(true);
    const services = servicesFor();
    await expect(new CineruvFamily().discoverMedia({ ...episode, year: 2013 }, source, services, signal)).resolves.toMatchObject({ type: 'streams' });
    const requests = (services.request as jest.Mock).mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.map(request => request.url.pathname)).toContain('/api/media/tv/1396/season/5');
    expect(requests.at(-1)?.url.href).toBe('https://api.movenerds.space/api/stream?tmdbId=1396&type=tv&title=Breaking+Bad&year=2008&season=5&episode=16&language=en');
    for (const media of [{ ...episode, season: 99 }, { ...episode, episode: 99 }]) {
      const missing = servicesFor();
      await expect(new CineruvFamily().discoverMedia(media, source, missing, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      expect((missing.request as jest.Mock).mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname === '/api/stream')).toBe(false);
    }
  });

  test('does not ask for playback when the source catalog identifies a different title, ID, type, or movie year', async () => {
    for (const media of [{ ...movie, title: 'FMHY Extractability Probe 7b18e49a', tmdbId: 2147483647, year: 1874 }, { ...movie, tmdbId: 1 }, { ...movie, year: 1980 }, { ...movie, type: 'episode' as const, season: 1, episode: 1 }]) {
      const services = servicesFor();
      await expect(new CineruvFamily().discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      expect((services.request as jest.Mock).mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname === '/api/stream')).toBe(false);
    }
    const catalog = JSON.parse(fixture('movie-inception.json')) as object;
    for (const change of [{ id: 1 }, { title: 'Another Title' }, { type: 'tv' }, { year: 1980 }]) {
      const services = servicesFor({ 'movie-inception.json': JSON.stringify({ ...catalog, ...change }) });
      await expect(new CineruvFamily().discoverMedia(movie, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      expect((services.request as jest.Mock).mock.calls.at(-1)?.[0].url.pathname).toBe('/api/media/movie/27205');
    }
  });

  test('checks the returned playback identity and keeps unavailable media absent', async () => {
    const family = new CineruvFamily();
    const original = JSON.parse(fixture('stream-breaking-bad-s05e16.json')) as object;
    for (const change of [{ title: 'Another Series' }, { season: 1 }, { episode: 1 }]) await expect(family.discoverMedia(episode, source, servicesFor({ 'stream-breaking-bad-s05e16.json': JSON.stringify({ ...original, ...change }) }), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    const wrongYear = fixture('stream-inception.json').replace('"year": 2010', '"year": 1980');
    await expect(family.discoverMedia(movie, source, servicesFor({ 'stream-inception.json': wrongYear }), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    await expect(family.discoverMedia(movie, source, servicesFor({ 'stream-inception.json': '{"success":false,"primarySources":[]}' }), signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
  });

  test('retains the native alternate providers once per source identity and excludes iframe-only resources', async () => {
    const payload = JSON.parse(fixture('stream-inception.json')) as { primarySources: { id: string; url: string }[]; allProviders?: object };
    payload.allProviders = { vidzee: [payload.primarySources[0], { id: 'alternate-hls', url: '/api/proxy/master.m3u8?url=https%3A%2F%2Fmedia.test%2Falternate.m3u8', type: 'hls', isDirect: false, requiresProxy: true }, { id: 'iframe-player', url: 'https://player.test/movie/27205', type: 'iframe' }, { id: 'non-http', url: 'ftp://media.test/master.m3u8', type: 'hls' }] };
    const result = await new CineruvFamily().discoverMedia(movie, source, servicesFor({ 'stream-inception.json': JSON.stringify(payload) }), signal);
    if (result.type !== 'streams') throw new Error('Expected native Cineruv streams');
    expect(result.streams).toHaveLength(4);
    expect(result.streams.at(-1)?.url.href).toBe('https://api.movenerds.space/api/proxy/master.m3u8?url=https%3A%2F%2Fmedia.test%2Falternate.m3u8');
    expect(result.streams.every(stream => stream.headers?.['origin'] === 'https://cineruv.website')).toBe(true);
  });

  test('reports changed catalog and playback contracts', async () => {
    const family = new CineruvFamily();
    await expect(family.discoverMedia(movie, source, servicesFor({ 'client.txt': fixture('client.txt').replaceAll('/api/stream', '/api/other') }), signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED' } });
    for (const [name, body, media] of [['search-inception.json', '{}', movie], ['tv-breaking-bad.json', '{"id":1396,"type":"tv","title":"Breaking Bad"}', episode], ['season-breaking-bad-5.json', '{"seasonNumber":5}', episode], ['stream-inception.json', '{"success":true}', movie]] as const) await expect(family.discoverMedia(media, source, servicesFor({ [name]: body }), signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED' } });
  });
});
