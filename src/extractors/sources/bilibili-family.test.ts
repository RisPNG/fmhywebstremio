import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ExtractionRequest, ExtractionResponse, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import { FamilyHealthRunner } from '../../engine/health';
import { StreamSelector } from '../../engine/protocols';
import { SourceRegistry } from '../../engine/registry';
import { ExtractionResolver, StaticExtractorLookup } from '../../engine/resolver';
import { BiliBiliFamily } from './bilibili-family';

const fixture = (name: string) => readFileSync(resolve(__dirname, `../__fixtures__/bilibili/${name}`), 'utf8');
const response = (url: URL, body: string, contentType = 'application/json'): ExtractionResponse => ({ status: 200, headers: { 'content-type': contentType }, finalUrl: url, redirectChain: [], body: Buffer.from(body), text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } });
const source: SourceRecord = { id: 'bilibili:bilibili.com', canonicalDomain: 'bilibili.tv', aliases: ['bilibili.com'], fmhy: { name: 'BiliBili', section: '▷ Streaming / 串流', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown', family: { id: 'bilibili', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, probe: { outcome: 'matched', observedAt: new Date(0), finalUrl: 'https://www.bilibili.tv/' } };
const media: MediaIdentity = { canonicalId: 'tmdb:310817:1:1', type: 'episode', title: 'Kisah Bawah Tanah', tmdbId: 310817, imdbId: 'tt33269221', year: 2026, season: 1, episode: 1, episodes: [{ season: 1, episode: 1, title: 'The Mart' }, { season: 1, episode: 2, title: 'Toyol Handler' }, { season: 1, episode: 26, title: 'Seven Wells' }] };
const episodeForAid = new Map([['4799034694834688', 1], ['4799034712005632', 2], ['4800380661144576', 26]]);
const servicesFor = (overrides: { search?: unknown; playlist?: unknown; info?: unknown; playback?: unknown } = {}): RequestServices & { request: jest.Mock } => ({ request: jest.fn(async (request: ExtractionRequest) => {
  if (request.url.hostname === 'media.test') return response(request.url, '', 'video/mp4');
  let data: unknown;
  if (request.url.pathname.endsWith('/search_v2')) data = overrides.search ?? JSON.parse(fixture(request.url.searchParams.get('keyword') === 'Kisah Bawah Tanah' ? 'search-series.json' : request.url.searchParams.get('keyword') === 'TheMart E1' ? 'search-first-episode.json' : 'search-absent.json'));
  else if (request.url.pathname.endsWith('/ugc/playlist')) data = overrides.playlist ?? JSON.parse(fixture('playlist.json'));
  else if (request.url.pathname.endsWith('/ugc/play/info')) data = overrides.info ?? JSON.parse(fixture(`episode-${episodeForAid.get(request.url.searchParams.get('aid') ?? '')}-info.json`));
  else if (request.url.pathname.endsWith('/playurl')) data = overrides.playback ?? JSON.parse(fixture(`episode-${episodeForAid.get(request.url.searchParams.get('aid') ?? '')}-playback.json`));
  else throw new Error(`Unexpected native request ${request.url.href}`);
  return response(request.url, JSON.stringify(data));
}) });

describe('BiliBili international public UGC collections', () => {
  test('recognizes the native BStar international frontend without matching a brand-only page', () => {
    const snapshot = { finalUrl: new URL('https://www.bilibili.tv/'), status: 200, headers: {}, htmlSample: fixture('home.html'), assetPaths: [], scriptSignatures: [], routeHints: [] };
    expect(new BiliBiliFamily().classify(source, snapshot)).toMatchObject({ familyId: 'bilibili', confidence: 1, evidence: [{ fingerprint: 'bilibili-international-brand' }, { fingerprint: 'bilibili-bstar-metadata' }, { value: 'bilibili-bstar-client' }] });
    expect(new BiliBiliFamily().classify(source, { ...snapshot, htmlSample: '<title>BiliBili</title>' })).toBeNull();
  });

  test.each([1, 2, 26])('binds episode %i through canonical first-episode search and the exact native collection', async (episode) => {
    const services = servicesFor();
    const result = await new BiliBiliFamily().discoverMedia({ ...media, episode }, source, services, new AbortController().signal);
    expect(result).toMatchObject({ type: 'streams', streams: expect.arrayContaining([expect.objectContaining({ url: new URL(`https://media.test/bilibili/e${episode}.mp4`), protocol: 'http', delivery: 'relayed', headers: { referer: 'https://www.bilibili.tv/' }, label: '360P', hostExtractor: 'bilibili-ugc' })]) });
    if (result.type !== 'streams') throw new Error('Missing native resources');
    expect(result.streams.every(stream => stream.language === undefined && stream.declaredResolution === undefined)).toBe(true);
    const selected = await new StreamSelector(services).validate(result.streams, { concurrency: 2 }, new AbortController().signal);
    expect(selected.streams).toMatchObject([{ validation: 'validated', url: new URL(`https://media.test/bilibili/e${episode}.mp4`) }]);
    expect(selected.streams).toHaveLength(1);
    const requests = services.request.mock.calls.map(([request]: [ExtractionRequest]) => request);
    expect(requests.filter(request => request.url.pathname.endsWith('/search_v2')).map(request => request.url.searchParams.get('keyword'))).toEqual(['TheMart E1']);
    const playback = requests.find(request => request.url.pathname.endsWith('/playurl'));
    expect(Object.fromEntries(playback?.url.searchParams ?? [])).toMatchObject({ aid: [...episodeForAid].find(([, value]) => value === episode)?.[0], platform: 'web', qn: '64', type: '0', device: 'wap', tf: '0', force_container: '2' });
    expect(requests.every(request => request.url.hostname === 'media.test' || request.url.hostname === 'api.bilibili.tv')).toBe(true);
    expect(requests.some(request => request.headers?.['cookie'] || request.headers?.['authorization'])).toBe(false);
    expect(requests.filter(request => request.url.pathname.endsWith('/playurl')).every(request => request.referrer?.origin === 'https://www.bilibili.tv')).toBe(true);
  });

  test.each([
    ['nearby title', 'Kisah Bawah Laut 2026'],
    ['different year', 'Kisah Bawah Tanah 2025'],
    ['different explicit season', 'Kisah Bawah Tanah 2026 Season 2'],
  ])('rejects a collection with a %s', async (_name, title) => {
    const playlist = JSON.parse(fixture('playlist.json'));
    playlist.data.title = title;
    const services = servicesFor({ playlist });
    await expect(new BiliBiliFamily().discoverMedia(media, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(services.request.mock.calls.some(([request]: [ExtractionRequest]) => request.url.pathname.endsWith('/playurl'))).toBe(false);
  });

  test.each([
    ['missing canonical seasons', undefined],
    ['multiple canonical seasons', [...(media.episodes ?? []), { season: 2, episode: 1, title: 'New Season' }]],
  ])('does not infer season one for an unlabeled collection with %s', async (_name, episodes) => {
    const identity = { ...media };
    if (episodes) identity.episodes = episodes;
    else delete identity.episodes;
    await expect(new BiliBiliFamily().discoverMedia(identity, source, servicesFor(), new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
  });

  test('accepts an explicit requested season while rejecting a different episode number', async () => {
    const playlist = JSON.parse(fixture('playlist.json'));
    playlist.data.title = 'Kisah Bawah Tanah 2026 Season 2';
    const services = servicesFor({ playlist });
    const seasonTwo = { ...media, season: 2, episodes: [...(media.episodes ?? []), { season: 2, episode: 1, title: 'The Mart' }] };
    await expect(new BiliBiliFamily().discoverMedia(seasonTwo, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
    await expect(new BiliBiliFamily().discoverMedia({ ...seasonTwo, episode: 12 }, source, servicesFor({ playlist: { ...playlist, data: { ...playlist.data, items: playlist.data.items.filter((item: { title: string }) => !item.title.includes('(E12)')) } } }), new AbortController().signal)).resolves.toMatchObject({ type: 'empty' });
  });

  test('requires the exact search seed to belong to the returned collection', async () => {
    const playlist = JSON.parse(fixture('playlist.json'));
    playlist.data.items = playlist.data.items.filter((item: { aid: string }) => item.aid !== '4799034694834688');
    await expect(new BiliBiliFamily().discoverMedia(media, source, servicesFor({ playlist }), new AbortController().signal)).resolves.toMatchObject({ type: 'empty' });
  });

  test('rejects an archive response for another native video instead of trusting the query', async () => {
    const info = JSON.parse(fixture('episode-2-info.json'));
    await expect(new BiliBiliFamily().discoverMedia(media, source, servicesFor({ info }), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', diagnostic: { parserPath: 'data.archive.aid/title' } } });
  });

  test('publishes only returned native muxed resources and does not expose separate video-only DASH', async () => {
    const playback = JSON.parse(fixture('episode-1-playback.json'));
    playback.data.playurl.video.forEach((video: { video_resource: { container: number } }) => {
      video.video_resource.container = 1;
    });
    await expect(new BiliBiliFamily().discoverMedia(media, source, servicesFor({ playback }), new AbortController().signal)).resolves.toMatchObject({ type: 'empty' });
  });

  test.each(['search', 'playlist', 'info', 'playback'] as const)('reports an actual %s schema change', async (stage) => {
    await expect(new BiliBiliFamily().discoverMedia(media, source, servicesFor({ [stage]: { code: 0, data: {} } }), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED' } });
  });

  test('does not treat native nonzero search codes as catalog absence', async () => {
    await expect(new BiliBiliFamily().discoverMedia(media, source, servicesFor({ search: { code: -1, message: 'Temporarily unavailable' } }), new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'SEARCH_FAILED' } });
  });

  test('preserves native playback rejection as an extraction failure without attempting authentication', async () => {
    const services = servicesFor({ playback: { code: -10403, message: 'Not available' } });
    await expect(new BiliBiliFamily().discoverMedia(media, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'HOST_EXTRACTION_FAILED' } });
    expect(services.request.mock.calls.filter(([request]: [ExtractionRequest]) => request.url.pathname.endsWith('/playurl'))).toHaveLength(1);
  });

  test('keeps verified alternatives after an independent native playlist fails', async () => {
    const search = JSON.parse(fixture('search-first-episode.json'));
    search.data.modules[0].items.push({ aid: '999', title: 'TheMart (E1) 💀' });
    const native = servicesFor({ search });
    const services: RequestServices = { request: async (request, signal) => {
      if (request.url.pathname.endsWith('/ugc/playlist') && request.url.searchParams.get('aid') === '999') throw new Error('Independent native playlist unavailable');
      return native.request(request, signal) as Promise<ExtractionResponse>;
    } };
    await expect(new BiliBiliFamily().discoverMedia(media, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'streams' });
  });

  test('uses the same native family and selector for health positives and a real negative search', async () => {
    const services = servicesFor();
    const registry = new SourceRegistry();
    registry.set(source);
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, new BiliBiliFamily(), { familyId: 'bilibili', cases: [
      ...[1, 2, 26].map(episode => ({ id: `episode-${episode}`, media: { ...media, episode }, expected: 'discoverable' as const })),
      { id: 'absent', media: { ...media, title: 'FMHY Extractability Probe 7b18e49a', year: 1874, episodes: [{ season: 1, episode: 1, title: 'FMHY Extractability Probe 7b18e49a' }] }, expected: 'absent' },
    ] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true }, staleCases: [], anomalies: [] });
    expect(registry.runtimeEligible()).toMatchObject([{ id: source.id }]);
  });

  test('returns empty for unsupported movie requests before using UGC episode discovery', async () => {
    const services = servicesFor();
    await expect(new BiliBiliFamily().discoverMedia({ canonicalId: 'tmdb:27205', type: 'movie', title: 'Inception', year: 2010, tmdbId: 27205 }, source, services, new AbortController().signal)).resolves.toEqual({ type: 'empty', reason: 'not-found' });
    expect(services.request).not.toHaveBeenCalled();
  });
});
