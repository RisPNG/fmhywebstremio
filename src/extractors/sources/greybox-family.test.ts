import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, ExtractionResult, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import type { VidoraHostArchitecture } from '../hosts/vidora-host-architecture';
import { GreyBoxFamily } from './greybox-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/greybox/${name}`), 'utf8');
const response = (url: URL, body: string): ExtractionResponse => ({ status: 200, headers: {}, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });

describe('GreyBox source family', () => {
  const source: SourceRecord = { id: 'greybox:greyboxtv.vercel.app', canonicalDomain: 'greyboxtv.vercel.app', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
  const movie: MediaIdentity = { canonicalId: 'tmdb:1303517', type: 'movie', tmdbId: 1303517, imdbId: 'tt31242447', title: 'Kahar: Kapla High Council', year: 2024 };
  const series: MediaIdentity = { canonicalId: 'tmdb:218507:1:1', type: 'episode', tmdbId: 218507, title: 'Project: High Council', year: 2023, season: 1, episode: 1 };
  const later: MediaIdentity = { canonicalId: 'tmdb:1396:5:16', type: 'episode', tmdbId: 1396, title: 'Breaking Bad', year: 2008, season: 5, episode: 16 };
  const signal = new AbortController().signal;
  const streams: ExtractionResult = { type: 'streams', streams: [{ url: new URL('https://media.test/full.mp4'), protocol: 'http', delivery: 'relayed', sourceId: source.id, sourceExtractor: 'greybox', hostExtractor: 'vidora-player', discoveredAt: new Date(0) }] };
  const servicesFor = (change: (request: ExtractionRequest, body: string) => string = (_request, body) => body): RequestServices => ({ request: jest.fn(async (request: ExtractionRequest) => {
    const path = request.url.pathname;
    const fixtures: Readonly<Record<string, string>> = { '/js/embed-sources.config.js': 'embed-sources.txt', '/js/stream.js': 'stream.txt', '/api/movie/1303517': 'movie-kahar.json', '/api/tv/218507': 'tv-project.json', '/api/tv/218507/season/1': 'season-project-1.json', '/api/tv/1396': 'tv-breaking-bad.json', '/api/tv/1396/season/5': 'season-breaking-bad-5.json' };
    const name = /^\/(?:movie|tv)\//.test(path) ? 'home.html' : fixtures[path];
    if (!name) throw new Error(`Unexpected native request ${request.url.href}`);
    return response(request.url, change(request, fixture(name)));
  }) });

  test('requires the GreyBox brand, native iframe, and all provider configuration assets', () => {
    const family = new GreyBoxFamily();
    const snapshot: SourceProbeSnapshot = { finalUrl: new URL('https://greyboxtv.vercel.app/home'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(family.classify(source, snapshot)).toMatchObject({ familyId: 'greybox', confidence: 1 });
    for (const [original, replacement] of [['Greybox —', 'Other —'], ['id="embed-frame"', 'id="player"'], ['/js/embed-sources.config.js', '/js/other.js'], ['/js/source-resolver.js', '/js/other.js'], ['/js/stream.js', '/js/other.js']]) {
      expect(family.classify(source, { ...snapshot, htmlSample: fixture('home.html').replace(original as string, replacement as string) })).toBeNull();
    }
  });

  test('uses exact native movie identity and the current runtime EMBED slot instead of stale registry mirrors', async () => {
    const host: VidoraHostArchitecture = { discover: jest.fn(async () => streams) };
    const services = servicesFor((request, body) => request.url.pathname === '/js/stream.js' ? body.replace('https://vidoraplayer.vidora-081.workers.dev', 'https://player.test').replace('moviePath: \'/embed/movie/{tmdb_id}\'', 'moviePath: \'/film/{id}\'') : body);
    await expect(new GreyBoxFamily(host).discoverMedia(movie, source, services, signal)).resolves.toBe(streams);
    expect(services.request).toHaveBeenNthCalledWith(1, { url: new URL('https://greyboxtv.vercel.app/movie/1303517'), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    expect(services.request).toHaveBeenNthCalledWith(2, { url: new URL('https://greyboxtv.vercel.app/api/movie/1303517'), expectedContent: 'json', referrer: new URL('https://greyboxtv.vercel.app/movie/1303517'), stateScope: { kind: 'source', key: source.id } }, signal);
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://greyboxtv.vercel.app/js/embed-sources.config.js?v=4'), referrer: new URL('https://greyboxtv.vercel.app/movie/1303517') }), signal);
    expect(host.discover).toHaveBeenCalledWith(movie, new URL('https://player.test/film/1303517'), source.id, 'greybox', services, signal, new URL('https://greyboxtv.vercel.app/movie/1303517'));
  });

  test('binds native first episodes, later episodes, and later seasons to exact TV/season catalogs', async () => {
    const host: VidoraHostArchitecture = { discover: jest.fn(async () => streams) };
    const services = servicesFor();
    const family = new GreyBoxFamily(host);
    for (const media of [series, { ...series, episode: 10 }, later]) await expect(family.discoverMedia(media, source, services, signal)).resolves.toBe(streams);
    expect(host.discover).toHaveBeenNthCalledWith(1, series, new URL('https://vidoraplayer.vidora-081.workers.dev/embed/tv/218507/1/1'), source.id, 'greybox', services, signal, new URL('https://greyboxtv.vercel.app/tv/218507'));
    expect(host.discover).toHaveBeenNthCalledWith(2, expect.objectContaining({ episode: 10 }), new URL('https://vidoraplayer.vidora-081.workers.dev/embed/tv/218507/1/10'), source.id, 'greybox', services, signal, new URL('https://greyboxtv.vercel.app/tv/218507'));
    expect(host.discover).toHaveBeenNthCalledWith(3, later, new URL('https://vidoraplayer.vidora-081.workers.dev/embed/tv/1396/5/16'), source.id, 'greybox', services, signal, new URL('https://greyboxtv.vercel.app/tv/1396'));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://greyboxtv.vercel.app/api/tv/1396/season/5') }), signal);
  });

  test.each([
    ['movie wrong ID', movie, '/api/movie/1303517', '"id": 1303517', '"id": 1303518'],
    ['movie wrong type', movie, '/api/movie/1303517', '"media_type": "movie"', '"media_type": "tv"'],
    ['movie wrong title', movie, '/api/movie/1303517', '"title": "Kahar: Kapla High Council"', '"title": "Another Movie"'],
    ['movie wrong year', movie, '/api/movie/1303517', '"release_date": "2024-11-28"', '"release_date": "2023-11-28"'],
    ['TV wrong ID', series, '/api/tv/218507', '"id": 218507', '"id": 218508'],
    ['season wrong series ID', series, '/api/tv/218507/season/1', '"id": 218507', '"id": 218508'],
    ['season wrong number', series, '/api/tv/218507/season/1', '"season_number": 1', '"season_number": 2'],
  ])('rejects %s before host extraction', async (_name, media, path, original, replacement) => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    const services = servicesFor((request, body) => request.url.pathname === path ? body.replace(original, replacement) : body);
    await expect(new GreyBoxFamily(host).discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('does not infer missing seasons or episode availability from a title or total count', async () => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    const family = new GreyBoxFamily(host);
    for (const media of [{ ...series, season: 2 }, { ...series, episode: 11 }]) await expect(family.discoverMedia(media, source, servicesFor(), signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test.each([
    ['disabled', 'enabled: true,\n        priority: 1,', 'enabled: false,\n        priority: 1,'],
    ['unsupported movie', 'supports: { movie: true, tv: true, sports: false }', 'supports: { movie: false, tv: true, sports: false }'],
  ])('respects the native %s provider instead of selecting sports or placeholder templates', async (_name, original, replacement) => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    const services = servicesFor((request, body) => request.url.pathname === '/js/embed-sources.config.js' ? body.replace(original, replacement) : body);
    await expect(new GreyBoxFamily(host).discoverMedia(movie, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'no-streams' });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test.each([
    ['/api/movie/1303517', 'RESPONSE_SCHEMA_CHANGED', 'id/media_type/title'],
    ['/api/tv/218507', 'RESPONSE_SCHEMA_CHANGED', 'id/media_type/title'],
    ['/api/tv/218507/season/1', 'RESPONSE_SCHEMA_CHANGED', 'id/season_number/episodes'],
    ['/js/embed-sources.config.js', 'PAGE_STRUCTURE_CHANGED', 'registry.providers/EMBED'],
    ['/js/stream.js', 'PAGE_STRUCTURE_CHANGED', 'registry.providers/EMBED'],
  ])('keeps a changed %s native contract as a typed failure', async (path, code, parserPath) => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    const services = servicesFor((request, body) => request.url.pathname === path ? '{}' : body);
    await expect(new GreyBoxFamily(host).discoverMedia(path.includes('/tv/') ? series : movie, source, services, signal)).resolves.toMatchObject({ type: 'failure', failure: { code, diagnostic: { parserPath } } });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('preserves normal catalog absence and real upstream transport failures', async () => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    for (const code of ['HTTP_NOT_FOUND', 'RATE_LIMITED'] as const) {
      const failure = new TransportFailure({ code, message: 'Native catalog response', stage: 'stage:discovery', sourceId: source.id, observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } });
      const services = servicesFor((request, body) => {
        if (request.url.pathname === '/api/movie/1303517') throw failure;
        return body;
      });
      const result = new GreyBoxFamily(host).discoverMedia(movie, source, services, signal);
      if (code === 'HTTP_NOT_FOUND') await expect(result).resolves.toEqual({ type: 'empty', reason: 'not-found' });
      else await expect(result).rejects.toBe(failure);
    }
    expect(host.discover).not.toHaveBeenCalled();
  });

  test.each([
    ['https://vidoraplayer.vidora-081.workers.dev', 'http://player.test'],
    ['moviePath: \'/embed/movie/{tmdb_id}\'', 'moviePath: \'/embed/movie/{unknown}\''],
  ])('preserves native rejection of insecure or unresolved configured iframe URLs', async (original, replacement) => {
    const host: VidoraHostArchitecture = { discover: jest.fn() };
    const services = servicesFor((request, body) => request.url.pathname === '/js/stream.js' ? body.replace(original, replacement) : body);
    await expect(new GreyBoxFamily(host).discoverMedia(movie, source, services, signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'EMBED_NOT_FOUND', diagnostic: { parserPath: 'provider-template' } } });
    expect(host.discover).not.toHaveBeenCalled();
  });

  test('passes the observed native document origin and final page to the host', async () => {
    const host: VidoraHostArchitecture = { discover: jest.fn(async () => streams) };
    const services = servicesFor();
    const recognized: SourceRecord = { ...source, probe: { outcome: 'matched', observedAt: new Date(0), finalUrl: 'https://www.greybox.test/home' } };
    await new GreyBoxFamily(host).discoverMedia(series, recognized, services, signal);
    expect(host.discover).toHaveBeenCalledWith(series, expect.any(URL), source.id, 'greybox', services, signal, new URL('https://www.greybox.test/tv/218507'));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://www.greybox.test/api/tv/218507') }), signal);
  });

  test('requires canonical TMDB identity and explicit requested TV coordinates', async () => {
    const services = servicesFor();
    const family = new GreyBoxFamily({ discover: jest.fn() });
    const missingId = { ...movie };
    const missingSeason = { ...series };
    const missingEpisode = { ...series };
    delete missingId.tmdbId;
    delete missingSeason.season;
    delete missingEpisode.episode;
    for (const media of [missingId, missingSeason, missingEpisode]) await expect(family.discoverMedia(media, source, services, signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(services.request).not.toHaveBeenCalled();
  });
});
