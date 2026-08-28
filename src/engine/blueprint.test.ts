import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { parseStremioMediaRequest, RuntimeStremioAdapter } from '../addon/stremio-adapter';
import { diffDirectory, FmhyDirectoryProvider, FmhyMaintenanceService, parseFmhyDirectory } from '../discovery/fmhy';
import { extractorRegistry } from '../extractors/registry.generated';
import { DooplayFamily } from '../extractors/sources/dooplay-family';
import type { ExtractionRequest, ExtractionResponse, Extractor, RequestServices, SourceRecord } from './core';
import { captureDiagnostic, categoryOf, defaultRetryPolicyOf, RuntimeStreamEngine, sanitizeDiagnosticUrl } from './core';
import { describeExtractionResult, SyntheticExtractor } from './core/testing/synthetic-extractor';
import { DependencyGraph, evaluateFamilyHealth, ExtractabilityAuditRunner, FamilyHealthRunner, SourceFamilyProbeRunner } from './health';
import { HlsInspector, StreamSelector } from './protocols';
import { MatcherRegistry, RegistryExtractorLookup, SourceRegistry } from './registry';
import { ExtractionResolver, StaticExtractorLookup } from './resolver';
import { TransportDirector, TransportFailure } from './transport';

const response = (url: string, body: string, contentType = 'text/html'): ExtractionResponse => {
  const bytes = new TextEncoder().encode(body);
  return { status: 200, headers: { 'content-type': contentType }, finalUrl: new URL(url), redirectChain: [], body: bytes, text: () => body, json: () => JSON.parse(body) as unknown, truncated: false, timing: { startedAt: new Date(0), elapsedMs: 1 } };
};

describe('blueprint contracts', () => {
  test('exercises every tagged extraction result through the synthetic contract', async () => {
    const extractor = new SyntheticExtractor();
    const services = { request: jest.fn() } as unknown as RequestServices;
    const signal = new AbortController().signal;
    const cases = [['streams', 'streams:1'], ['redirect', 'redirect:synthetic://fixture/streams'], ['embeds', 'embeds:1'], ['empty', 'empty:no-streams'], ['failure', 'failure:NO_STREAM_CANDIDATE']] as const;
    for (const [path, expected] of cases) expect(describeExtractionResult(await extractor.extract({ url: new URL(`synthetic://fixture/${path}`) }, services, signal))).toBe(expected);
  });

  test('diagnostics are bounded and sanitized', () => {
    expect(categoryOf('TIMEOUT')).toBe('category:network');
    expect(defaultRetryPolicyOf('STREAM_EXPIRED')).toBe('re-extract');
    expect(sanitizeDiagnosticUrl(new URL('https://user:pass@example.com/a?token=secret#x'))).toBe('https://example.com/a?token=');
    expect(captureDiagnostic({ headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: new TextEncoder().encode('abcdef') }, { maxBytes: 3 })).toMatchObject({ bodyCaptured: true, bodyBytes: 6, bodySample: 'abc', bodyTruncated: true });
    expect(captureDiagnostic({}, { maxBytes: 3 }).bodyCaptured).toBe(false);
  });

  test('resolver owns redirects, embeds, cycles, depth, and unexpected failures', async () => {
    const services = { request: jest.fn() } as unknown as RequestServices;
    const extractor: Extractor = {
      id: 'fixture', match: () => ({ matcherId: 'fixture', confidence: 1 }),
      extract: async target => target.url.pathname === '/root' ? { type: 'embeds', targets: [{ url: new URL('https://fixture.test/stream') }, { url: new URL('https://fixture.test/failure') }] } : target.url.pathname === '/stream' ? { type: 'streams', streams: [{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls', sourceId: 'fixture', sourceExtractor: 'fixture', discoveredAt: new Date(0) }] } : { type: 'failure', failure: { code: 'NO_STREAM_CANDIDATE', message: 'none', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } } },
    };
    const resolver = new ExtractionResolver(new StaticExtractorLookup([extractor]), services);
    const result = await resolver.resolve({ url: new URL('https://fixture.test/root') }, new AbortController().signal);
    expect(result.streams).toHaveLength(1);
    expect(result.failures[0]?.code).toBe('NO_STREAM_CANDIDATE');
    const cycle: Extractor = { id: 'cycle', match: () => ({ matcherId: 'cycle', confidence: 2 }), extract: async target => ({ type: 'redirect', target }) };
    expect((await new ExtractionResolver(new StaticExtractorLookup([cycle]), services).resolve({ url: new URL('https://fixture.test/cycle') }, new AbortController().signal)).failures[0]?.code).toBe('EXTRACTION_CYCLE');
    const chain: Extractor = { id: 'chain', match: () => ({ matcherId: 'chain', confidence: 3 }), extract: async target => ({ type: 'redirect', target: { url: new URL(`https://fixture.test/${Number(target.url.pathname.slice(1) || 0) + 1}`) } }) };
    expect((await new ExtractionResolver(new StaticExtractorLookup([chain]), services, { maxDepth: 1 }).resolve({ url: new URL('https://fixture.test/0') }, new AbortController().signal)).failures[0]?.code).toBe('EXTRACTION_DEPTH_EXCEEDED');
  });

  test('matcher registry chooses the specific media matcher', () => {
    const registry = new MatcherRegistry(extractorRegistry);
    expect(registry.match({ url: new URL('https://cdn.example/master.m3u8') })?.metadata.id).toBe('generic-media');
    expect(registry.collisions(['https://cdn.example/master.m3u8'])).toEqual({ 'https://cdn.example/master.m3u8': ['generic-media:media-url', 'generic-embed-page:html-page'] });
    for (const entry of extractorRegistry) for (const matcher of entry.matchers) {
      for (const url of matcher.positive) expect(registry.match({ url: new URL(url) })).not.toBeNull();
      for (const url of matcher.negative) expect(registry.match({ url: new URL(url) })?.matcher.id).not.toBe(matcher.id);
    }
  });

  test('transport rejects SSRF targets before connecting', async () => {
    await expect(new TransportDirector().request({ url: new URL('http://127.0.0.1/metadata') }, new AbortController().signal)).rejects.toMatchObject({ failure: { code: 'CONNECTION_FAILED', diagnostic: { finalUrl: 'http://127.0.0.1/metadata' } } });
    await expect(new TransportDirector({ blockedCidrs: ['203.0.113.0/24'] }).request({ url: new URL('http://203.0.113.10/') }, new AbortController().signal)).rejects.toBeInstanceOf(TransportFailure);
  });
});

describe('FMHY registry and health', () => {
  const markdown = '# Movies / TV\n## Streaming Sites\n- ⭐ [Alpha](https://alpha.example/watch) / [Mirror](https://mirror.example) `English`\n- [Beta API](https://beta.example)';
  test('parses, normalizes, diffs, and preserves last-known-good', async () => {
    const snapshot = parseFmhyDirectory(markdown, new Date(0));
    expect(snapshot.entries).toHaveLength(2);
    expect(snapshot.entries[0]).toMatchObject({ name: 'Alpha', tags: ['English', 'recommended'], apiHint: false });
    expect(diffDirectory(undefined, snapshot)).toHaveLength(2);
    expect(diffDirectory(snapshot, snapshot)).toEqual([{ type: 'UNCHANGED', source: '*' }]);
    const services: RequestServices = { request: jest.fn().mockResolvedValueOnce(response('https://fmhy.test/data', markdown, 'text/plain')).mockRejectedValueOnce(new Error('network')) };
    const provider = new FmhyDirectoryProvider(services, new URL('https://fmhy.test/data'));
    const first = await provider.fetchSnapshot(new AbortController().signal);
    const second = await provider.fetchSnapshot(new AbortController().signal);
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, failure: { code: 'DIRECTORY_FETCH_FAILED' }, snapshot: { entries: expect.any(Array) } });
    const registry = new SourceRegistry();
    registry.apply(snapshot);
    expect(registry.list(['unknown'])).toHaveLength(2);
    expect(registry.list(['unknown'])[0]).toMatchObject({ canonicalDomain: 'alpha.example', aliases: ['mirror.example'] });
  });

  test('parses a durable fixture matching the maintained FMHY format', () => {
    const snapshot = parseFmhyDirectory(readFileSync(resolvePath(__dirname, '../discovery/fmhy/__fixtures__/video-current.md'), 'utf8'), new Date(0));
    expect(snapshot.entries).toMatchObject([
      { name: 'Z-Stream', section: '▷ P-Stream Forks', tags: ['recommended'], urls: [new URL('https://zstream.mov/')] },
      { name: 'PlayTorrio', section: '▷ Stream Aggregators', urls: [new URL('https://playtorrio.xyz/'), new URL('https://playtorrio.pages.dev/')] },
      { name: 'Rive', section: '▷ Stream Aggregators', tags: ['recommended'], urls: [new URL('https://www.rivestream.app/'), new URL('https://rivestream.ru/'), new URL('https://rivestream.vip/'), new URL('https://watch.corsflix.net/'), new URL('https://corsflix.net/')] },
    ]);
    expect(() => parseFmhyDirectory(readFileSync(resolvePath(__dirname, '../discovery/fmhy/__fixtures__/video-malformed.md'), 'utf8'))).toThrow('DIRECTORY_PARSE_PARTIAL');
    expect(() => parseFmhyDirectory(readFileSync(resolvePath(__dirname, '../discovery/fmhy/__fixtures__/video-irrelevant.md'), 'utf8'))).toThrow('DIRECTORY_CATEGORY_MISSING');
  });

  test('classifies from one snapshot and applies health quorum', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://clone.test/', '<html><head><script src="/wp-content/themes/dooplay/app.js"></script></head><body><a href="/movies/x">x</a><script>window.dooplay=true</script></body></html>')) };
    const source: SourceRecord = { id: 'clone', canonicalDomain: 'clone.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
    const recognized = await new SourceFamilyProbeRunner(services, [new DooplayFamily()], { maxRequests: 1, maxBytes: 10000, deadlineMs: 1000 }).recognize(source, new AbortController().signal);
    expect(recognized.type).toBe('matched');
    const corpus = { familyId: 'dooplay', cases: [{ id: 'movie', media: { canonicalId: 'm', type: 'movie' as const, title: 'Movie' }, expected: 'discoverable' as const }, { id: 'episode', media: { canonicalId: 'e', type: 'episode' as const, title: 'Show' }, expected: 'discoverable' as const }, { id: 'absent', media: { canonicalId: 'a', type: 'movie' as const, title: 'Missing' }, expected: 'absent' as const }] };
    expect(evaluateFamilyHealth(corpus, [{ caseId: 'movie', expected: 'discoverable', discovered: true, stages: { discovery: true, extraction: true, validation: true } }, { caseId: 'episode', expected: 'discoverable', discovered: false, stages: { discovery: false } }, { caseId: 'absent', expected: 'absent', discovered: true, stages: { discovery: true } }], 0.6)).toMatchObject({ status: 'healthy', staleCases: ['episode'], anomalies: ['absent'] });
    expect(evaluateFamilyHealth(corpus, [{ caseId: 'movie', expected: 'discoverable', discovered: true, stages: { discovery: true, extraction: true, validation: false } }, { caseId: 'episode', expected: 'discoverable', discovered: true, stages: { discovery: true, extraction: true, validation: false } }], 0.5)).toMatchObject({ status: 'degraded', extractable: false, stages: { discovery: true, extraction: true, validation: false } });
  });

  test('reports a candidate that redirects to another site separately', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValueOnce(response('https://fmhy.test/data', '# Movies / TV\n## Streaming Sites\n- [Alpha](https://alpha.example)')).mockResolvedValueOnce(response('https://other.example/', '<script src="/wp-content/themes/dooplay/app.js"></script><a href="/movies/x">x</a>')) };
    const registry = new SourceRegistry();
    const probes = new SourceFamilyProbeRunner(services, [new DooplayFamily()], { maxRequests: 1, maxBytes: 10000, deadlineMs: 1000 });
    await new FmhyMaintenanceService(new FmhyDirectoryProvider(services, new URL('https://fmhy.test/data')), registry, probes).synchronize(new AbortController().signal);
    const source = registry.list()[0];
    expect(source).toMatchObject({ status: 'unsupported', probe: { outcome: 'redirected', finalUrl: 'https://other.example/' } });
    const health = new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry);
    const report = await new ExtractabilityAuditRunner(registry, health, new Map(), new Map()).run(new AbortController().signal);
    expect(report).toMatchObject({ ok: false, totals: { redirected: 1, runtimeEligible: 0 }, sites: [{ status: 'redirected', observedFinalUrl: 'https://other.example/' }] });
  });

  test('distinguishes a blocked family probe from an unreachable site', async () => {
    const source: SourceRecord = { id: 'blocked', canonicalDomain: 'blocked.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
    const blocked: RequestServices = { request: jest.fn().mockRejectedValue(new TransportFailure({ code: 'HTTP_FORBIDDEN', message: 'forbidden', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } })) };
    const unavailable: RequestServices = { request: jest.fn().mockRejectedValue(new TransportFailure({ code: 'DNS_FAILED', message: 'dns failed', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } })) };
    await expect(new SourceFamilyProbeRunner(blocked, [new DooplayFamily()], { maxRequests: 1, maxBytes: 10000, deadlineMs: 1000 }).recognize(source, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'FAMILY_PROBE_BLOCKED' } });
    await expect(new SourceFamilyProbeRunner(unavailable, [new DooplayFamily()], { maxRequests: 1, maxBytes: 10000, deadlineMs: 1000 }).recognize(source, new AbortController().signal)).resolves.toMatchObject({ type: 'failure', failure: { code: 'FAMILY_PROBE_NETWORK_FAILED' } });
  });

  test('discovers a Dooplay result whose title is outside its link', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://clone.test/?s=Inception+2010', '<div class="search-page"><article class="item movies"><div class="poster"><a href="/movie/inception-2010/"><div class="see"></div></a></div><div class="data"><h3>Inception (2010)</h3></div></article></div>')) };
    const source: SourceRecord = { id: 'clone', canonicalDomain: 'clone.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
    await expect(new DooplayFamily().discoverMedia({ canonicalId: 'movie', type: 'movie', title: 'Inception', year: 2010 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'redirect', target: { url: new URL('https://clone.test/movie/inception-2010/') } });
  });

  test('maps a Dooplay series result through its season and episode pages', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValueOnce(response('https://clone.test/?s=Breaking+Bad+2008', '<div class="search-page"><article><a href="/series/breaking-bad/"></a><h3>Breaking Bad (2008)</h3></article></div>')).mockResolvedValueOnce(response('https://clone.test/series/breaking-bad/', '<a href="/seasons/breaking-bad-season-1/">Season 1</a>')).mockResolvedValueOnce(response('https://clone.test/seasons/breaking-bad-season-1/', '<a href="/episodes/breaking-bad-season-1-episode-1/">Episode 1</a>')) };
    const source: SourceRecord = { id: 'clone', canonicalDomain: 'clone.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unknown' };
    await expect(new DooplayFamily().discoverMedia({ canonicalId: 'episode', type: 'episode', title: 'Breaking Bad', year: 2008, season: 1, episode: 1 }, source, services, new AbortController().signal)).resolves.toMatchObject({ type: 'redirect', target: { url: new URL('https://clone.test/episodes/breaking-bad-season-1-episode-1/') } });
  });

  test('reports every site while succeeding when at least one is extractable', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://cdn.test/master.m3u8', '#EXTM3U\n#EXTINF:4,\nsegment.ts', 'application/vnd.apple.mpegurl')) };
    const registry = new SourceRegistry();
    for (const id of ['good', 'bad']) registry.set({ id, canonicalDomain: `${id}.test`, aliases: [], fmhy: { section: 'Movie Streaming', tags: ['recommended'], firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' });
    registry.set({ id: 'other', canonicalDomain: 'other.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, status: 'unsupported' });
    const family = {
      id: 'fixture',
      classify: () => null,
      discoverMedia: async (_media: unknown, source: SourceRecord) => source.id === 'good'
        ? { type: 'streams' as const, streams: [{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] }
        : { type: 'empty' as const, reason: 'not-found' as const },
    };
    const selector = new StreamSelector(services);
    const health = new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), selector, services, registry);
    const corpus = { familyId: 'fixture', cases: [{ id: 'movie', media: { canonicalId: 'm', type: 'movie' as const, title: 'Movie' }, expected: 'discoverable' as const }] };
    const report = await new ExtractabilityAuditRunner(registry, health, new Map([['fixture', family]]), new Map([['fixture', corpus]])).run(new AbortController().signal);
    expect(report).toMatchObject({ ok: true, totals: { sites: 3, passed: 1, runtimeEligible: 1, extractable: 1, failed: 1, unsupported: 1 } });
    expect(report.sites.find(site => site.sourceId === 'good')).toMatchObject({ section: 'Movie Streaming', tags: ['recommended'], status: 'extractable', runtimeEligible: true, stages: { validation: true } });
    expect(registry.health().get('bad')).toMatchObject({ lastOutcome: 'failed' });
  });

  test('rolls provider failures up to affected sources', () => {
    const graph = new DependencyGraph();
    graph.record({ sourceId: 'a', familyId: 'dooplay', provider: 'host.test', observedAt: new Date(0) });
    graph.record({ sourceId: 'b', familyId: 'dooplay', provider: 'host.test', observedAt: new Date(0) });
    expect(graph.rollup([{ code: 'HOST_EXTRACTION_FAILED', message: 'bad', targetHost: 'host.test', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } }])).toEqual({ 'HOST_EXTRACTION_FAILED:host.test': ['a', 'b'] });
  });
});

describe('protocol vertical slice', () => {
  test('keeps a permanent Dooplay to GXPlayer to validated HLS fixture path', async () => {
    const fixtures = new Map([
      ['clone.test/', readFileSync(resolvePath(__dirname, '../extractors/__fixtures__/vertical-slice/search.html'), 'utf8')],
      ['clone.test/movie/inception/', readFileSync(resolvePath(__dirname, '../extractors/__fixtures__/vertical-slice/content.html'), 'utf8')],
      ['clone.test/wp-admin/admin-ajax.php', readFileSync(resolvePath(__dirname, '../extractors/__fixtures__/vertical-slice/lazy-player.html'), 'utf8')],
      ['watch.gxplayer.xyz/watch', readFileSync(resolvePath(__dirname, '../extractors/__fixtures__/vertical-slice/gxplayer.html'), 'utf8')],
      ['watch.gxplayer.xyz/m3u8/3/30b4a92517ace5825f5944c8a794ad3e/master.txt', readFileSync(resolvePath(__dirname, '../extractors/__fixtures__/vertical-slice/master.m3u8'), 'utf8')],
    ]);
    const services: RequestServices = {
      request: jest.fn(async (request: ExtractionRequest) => {
        const key = `${request.url.hostname}${request.url.pathname}`;
        const body = fixtures.get(key);
        if (request.url.hostname === 'failed-host.test') return response(request.url.href, '<html></html>');
        if (body === undefined) throw new Error(`Missing vertical-slice fixture for ${key}`);
        return response(request.url.href, body, request.expectedContent === 'manifest' ? 'application/vnd.apple.mpegurl' : 'text/html');
      }),
    };
    const registry = new SourceRegistry();
    const source: SourceRecord = { id: 'clone', canonicalDomain: 'clone.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'dooplay', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
    registry.set(source);
    const dependencies = new DependencyGraph();
    const resolver = new ExtractionResolver(new RegistryExtractorLookup(new MatcherRegistry(extractorRegistry)), services, { onDelegation: (_parent, child) => dependencies.record({ sourceId: String(child.hints?.['sourceId']), familyId: String(child.hints?.['sourceExtractor']), provider: child.url.hostname, observedAt: new Date(0) }) });
    const outcome = await new FamilyHealthRunner(resolver, new StreamSelector(services), services, registry, 0.5, dependencies).run(source, new DooplayFamily(), { familyId: 'dooplay', cases: [{ id: 'inception', media: { canonicalId: 'tmdb:27205', type: 'movie', title: 'Inception', year: 2010 }, expected: 'discoverable' }] }, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'healthy', extractable: true, stages: { discovery: true, extraction: true, validation: true }, cases: [{ stages: { validation: true } }] });
    expect(registry.get('clone')).toMatchObject({ status: 'supported' });
    expect(dependencies.list()).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: 'clone', familyId: 'dooplay', provider: 'watch.gxplayer.xyz' })]));
    expect(services.request).toHaveBeenCalledWith(expect.objectContaining({ url: new URL('https://clone.test/wp-admin/admin-ajax.php'), method: 'POST', body: 'action=lazy_player&movieID=48162' }), expect.any(AbortSignal));
  });

  test('inspects HLS and deterministically selects top K', async () => {
    const manifest = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1280x720,CODECS="avc1,mp4a"\n720.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080,CODECS="avc1,mp4a"\n1080.m3u8';
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://cdn.test/master.m3u8', manifest, 'application/vnd.apple.mpegurl')) };
    const candidate = { url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: 'a', sourceExtractor: 'dooplay', discoveredAt: new Date(0) };
    expect(await new HlsInspector().inspect(candidate, services, new AbortController().signal)).toMatchObject({ validation: 'validated', resolution: { width: 1920, height: 1080 }, bitrate: 3000000 });
    const result = await new StreamSelector(services).validate([candidate, { ...candidate, url: new URL('https://cdn.test/other.m3u8'), sourceId: 'b' }], { topK: 1 }, new AbortController().signal);
    expect(result.streams.map(stream => stream.sourceId)).toEqual(['a']);
  });

  test('orders preferred languages before unlisted languages', () => {
    const services = { request: jest.fn() } as unknown as RequestServices;
    const candidate = { url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) };
    const ordered = new StreamSelector(services).preOrder([{ ...candidate, language: 'fr' }, { ...candidate, url: new URL('https://cdn.test/english.m3u8'), language: 'en' }], { topK: 2, preferredLanguages: ['en'] });
    expect(ordered.map(stream => stream.language)).toEqual(['en', 'fr']);
  });

  test('preserves typed protocol validation failures', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://cdn.test/broken.m3u8', '<html>not a manifest</html>', 'text/plain')) };
    const result = await new StreamSelector(services).validate([{ url: new URL('https://cdn.test/broken.m3u8'), protocol: 'hls', sourceId: 'source', sourceExtractor: 'family', hostExtractor: 'host', discoveredAt: new Date(0) }], { topK: 1 }, new AbortController().signal);
    expect(result).toMatchObject({ streams: [], failures: [{ code: 'MANIFEST_INVALID', stage: 'stage:protocol', sourceId: 'source', extractorId: 'host', targetHost: 'cdn.test' }] });
  });

  test('reports a validation failure instead of an earlier failed embed when extraction found a candidate', async () => {
    const services: RequestServices = { request: jest.fn().mockRejectedValue(new TransportFailure({ code: 'CONNECTION_FAILED', message: 'expired stream', observedAt: new Date(0), diagnostic: { sensitivity: 'privileged', bodyCaptured: false } })) };
    const source: SourceRecord = { id: 'clone', canonicalDomain: 'clone.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
    const registry = new SourceRegistry();
    registry.set(source);
    const family = { id: 'fixture', classify: () => null, discoverMedia: async () => ({ type: 'streams' as const, streams: [{ url: new URL('https://expired.test/video.mp4'), protocol: 'http' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] }) };
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: 'fixture', cases: [{ id: 'movie', media: { canonicalId: 'm', type: 'movie', title: 'Movie' }, expected: 'discoverable' }] }, new AbortController().signal);
    expect(outcome.cases[0]?.failure).toMatchObject({ code: 'CONNECTION_FAILED', stage: 'stage:protocol' });
  });

  test('returns a known-protocol candidate as explicitly unverified when validation is cancelled', async () => {
    const services = { request: jest.fn() } as unknown as RequestServices;
    const controller = new AbortController();
    controller.abort();
    const result = await new StreamSelector(services).validate([{ url: new URL('https://cdn.test/pending.m3u8'), protocol: 'hls', sourceId: 'source', sourceExtractor: 'family', discoveredAt: new Date(0) }], { topK: 1 }, controller.signal);
    expect(result).toMatchObject({ streams: [{ validation: 'unverified', sourceId: 'source', protocol: 'hls' }], unverified: [{ sourceId: 'source' }], failures: [] });
  });

  test('does not make an unverified health result runtime eligible', async () => {
    const services = { request: jest.fn() } as unknown as RequestServices;
    const registry = new SourceRegistry();
    const source: SourceRecord = { id: 'source', canonicalDomain: 'source.test', aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'unknown' };
    registry.set(source);
    const family = { id: 'fixture', classify: () => null, discoverMedia: async () => ({ type: 'streams' as const, streams: [{ url: new URL('https://cdn.test/pending.m3u8'), protocol: 'hls' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] }) };
    const controller = new AbortController();
    controller.abort();
    const outcome = await new FamilyHealthRunner(new ExtractionResolver(new StaticExtractorLookup([]), services), new StreamSelector(services), services, registry).run(source, family, { familyId: 'fixture', cases: [{ id: 'movie', media: { canonicalId: 'movie', type: 'movie', title: 'Movie' }, expected: 'discoverable' }] }, controller.signal);
    expect(outcome).toMatchObject({ extractable: false, stages: { validation: false } });
    expect(registry.get(source.id)?.status).toBe('degraded');
  });

  test('parses Stremio identity without leaking route types into the engine', () => {
    expect(parseStremioMediaRequest('series', 'tt123:2:3')).toEqual({ type: 'episode', imdbId: 'tt123', season: 2, episode: 3 });
    expect(parseStremioMediaRequest('movie', 'tmdb:42')).toEqual({ type: 'movie', tmdbId: 42 });
  });

  test('applies configured FMHY source exclusions to runtime selection', async () => {
    const engine = { findStreams: jest.fn().mockResolvedValue({ streams: [], failures: [], unverified: [], deadline: { budgetMs: 1, elapsedMs: 1, exceeded: false, sourcesAttempted: 0, sourcesCompleted: 0, sourcesCancelled: 0 } }) };
    const ctx = { hostUrl: new URL('https://addon.test/'), id: 'request', config: { 'disableFmhySource_aether:aether.test': 'on', 'multi': 'on' } };
    await new RuntimeStremioAdapter(engine).findStreams(ctx, 'movie', 'tmdb:27205');
    expect(engine.findStreams).toHaveBeenCalledWith({ type: 'movie', tmdbId: 27205 }, { excludedSourceIds: ['aether:aether.test'] });
  });

  test('returns a fast validated result while cancelling a slow source', async () => {
    const services: RequestServices = {
      request: jest.fn().mockResolvedValue(response('https://cdn.test/master.m3u8', '#EXTM3U\n#EXTINF:4,\nsegment.ts', 'application/vnd.apple.mpegurl')),
    };
    const registry = new SourceRegistry();
    for (const id of ['fast', 'slow']) registry.set({ id, canonicalDomain: `${id}.test`, aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' });
    for (const id of ['fast', 'slow']) registry.recordHealth({ sourceId: id, lastOutcome: 'healthy', recentSuccesses: 1, recentFailures: 0, observedAt: new Date(0) });
    const family = {
      id: 'fixture',
      classify: () => null,
      discoverMedia: async (_media: unknown, source: SourceRecord, _services: RequestServices, signal: AbortSignal) => {
        void _media;
        void _services;
        if (source.id === 'slow') await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
        if (source.id === 'slow') return { type: 'empty' as const, reason: 'no-streams' as const };
        return { type: 'streams' as const, streams: [{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] };
      },
    };
    const engine = new RuntimeStreamEngine(
      { resolve: async () => ({ canonicalId: 'movie', type: 'movie', title: 'Movie' }) },
      registry,
      new Map([['fixture', family]]),
      new ExtractionResolver(new StaticExtractorLookup([]), services),
      services,
    );
    const result = await engine.findStreams({ type: 'movie', title: 'Movie' }, { deadlineMs: 100, validationTopK: 1 });
    expect(result.streams).toMatchObject([{ validation: 'validated', sourceId: 'fast' }]);
    expect(result.deadline).toMatchObject({ sourcesAttempted: 2, sourcesCompleted: 1, sourcesCancelled: 1 });
  });

  test('queries only sources with a successful extractability outcome', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://cdn.test/master.m3u8', '#EXTM3U\n#EXTINF:4,\nsegment.ts', 'application/vnd.apple.mpegurl')) };
    const registry = new SourceRegistry();
    for (const id of ['eligible', 'failed']) registry.set({ id, canonicalDomain: `${id}.test`, aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: id === 'eligible' ? 'supported' : 'degraded' });
    registry.recordHealth({ sourceId: 'eligible', lastOutcome: 'healthy', recentSuccesses: 1, recentFailures: 0, observedAt: new Date(0) });
    registry.recordHealth({ sourceId: 'failed', lastOutcome: 'failed', recentSuccesses: 0, recentFailures: 1, observedAt: new Date(0) });
    const family = {
      id: 'fixture',
      classify: () => null,
      discoverMedia: async (_media: unknown, source: SourceRecord) => ({ type: 'streams' as const, streams: [{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] }),
    };
    const result = await new RuntimeStreamEngine({ resolve: async () => ({ canonicalId: 'movie', type: 'movie', title: 'Movie' }) }, registry, new Map([['fixture', family]]), new ExtractionResolver(new StaticExtractorLookup([]), services), services).findStreams({ type: 'movie', title: 'Movie' });
    expect(result.deadline.sourcesAttempted).toBe(1);
    expect(result.streams).toMatchObject([{ sourceId: 'eligible' }]);
  });

  test('widens healthy source batches only when earlier sources produce too few candidates', async () => {
    const services: RequestServices = { request: jest.fn().mockResolvedValue(response('https://cdn.test/master.m3u8', '#EXTM3U\n#EXTINF:4,\nsegment.ts', 'application/vnd.apple.mpegurl')) };
    const registry = new SourceRegistry();
    for (let index = 0; index < 6; index++) {
      const id = `source-${index}`;
      registry.set({ id, canonicalDomain: `${id}.test`, aliases: [], fmhy: { firstSeenAt: new Date(0), lastSeenAt: new Date(0) }, family: { id: 'fixture', confidence: 1, evidence: [], lastProbedAt: new Date(0) }, status: 'supported' });
      registry.recordHealth({ sourceId: id, lastOutcome: 'healthy', recentSuccesses: 1, recentFailures: 0, observedAt: new Date(0) });
    }
    const family = {
      id: 'fixture',
      classify: () => null,
      discoverMedia: async (_media: unknown, source: SourceRecord) => source.id === 'source-4' ? { type: 'streams' as const, streams: [{ url: new URL('https://cdn.test/master.m3u8'), protocol: 'hls' as const, sourceId: source.id, sourceExtractor: 'fixture', discoveredAt: new Date(0) }] } : { type: 'empty' as const, reason: 'not-found' as const },
    };
    const result = await new RuntimeStreamEngine({ resolve: async () => ({ canonicalId: 'movie', type: 'movie', title: 'Movie' }) }, registry, new Map([['fixture', family]]), new ExtractionResolver(new StaticExtractorLookup([]), services), services).findStreams({ type: 'movie', title: 'Movie' }, { initialSourceBatch: 2, minimumCandidates: 1 });
    expect(result.deadline.sourcesAttempted).toBe(6);
    expect(result.streams).toMatchObject([{ sourceId: 'source-4' }]);
  });
});
