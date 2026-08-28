import type { ScrapeMedia, Stream } from '@movie-web/providers';
import { makeProviders, makeStandardFetcher, targets } from '@movie-web/providers';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

export interface PStreamProviderArchitecture {
  discover(media: ScrapeMedia, services: RequestServices, signal: AbortSignal): Promise<{ sourceId: string; embedId?: string; stream: Stream } | null>;
}

export class MovieWebProviderArchitecture implements PStreamProviderArchitecture {
  public async discover(media: ScrapeMedia, services: RequestServices, signal: AbortSignal): Promise<{ sourceId: string; embedId?: string; stream: Stream } | null> {
    const providerController = new AbortController();
    const abortProviders = () => providerController.abort();
    signal.addEventListener('abort', abortProviders, { once: true });
    const timeout = setTimeout(abortProviders, 12000);
    const fetcher = makeStandardFetcher(async (url, options) => {
      const requestOptions = options ?? { method: 'GET', headers: {}, body: undefined, credentials: undefined, signal: undefined };
      const requestController = new AbortController();
      const abortRequest = () => requestController.abort();
      if (providerController.signal.aborted || requestOptions.signal?.aborted) requestController.abort();
      providerController.signal.addEventListener('abort', abortRequest, { once: true });
      requestOptions.signal?.addEventListener('abort', abortRequest, { once: true });
      try {
        const response = await services.request({ url: new URL(url), method: requestOptions.method as 'GET' | 'POST' | 'HEAD', headers: requestOptions.headers, ...(typeof requestOptions.body === 'string' || requestOptions.body instanceof Uint8Array ? { body: requestOptions.body } : {}), expectedContent: 'binary', stateScope: { kind: 'source', key: 'pstream-providers' } }, requestController.signal);
        return { status: response.status, url: response.finalUrl.href, headers: new Headers(response.headers), text: async () => response.text(), json: async () => response.json() };
      } finally {
        providerController.signal.removeEventListener('abort', abortRequest);
        requestOptions.signal?.removeEventListener('abort', abortRequest);
      }
    });
    try {
      return await makeProviders({ fetcher, target: targets.NATIVE, consistentIpForRequests: true }).runAll({ media, sourceOrder: ['8stream', 'streambox', 'soapertv', 'whvxMirrors', '2embed', 'm4ufree', 'catflix', 'hdrezka', 'mp4hydra', 'nites', 'primewire', 'tugaflix'] });
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abortProviders);
    }
  }
}

export class PStreamFamily implements SourceFamily {
  public readonly id = 'pstream';

  public constructor(private readonly providers: PStreamProviderArchitecture = new MovieWebProviderArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.assetPaths.some(path => /(?:^|\/)config\.js$/i.test(path))) evidence.push({ type: 'asset-path', value: '/config.js' });
    if (snapshot.assetPaths.some(path => /(?:caption-parsing|language-db|auth)-[^/]+\.js$/i.test(path))) evidence.push({ type: 'asset-path', value: 'pstream-provider-assets' });
    if (snapshot.htmlSample && /P-Stream|VITE_CORS_PROXY_URL|pstream-provider/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'pstream-client' });
    if (evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || !media.year) return { type: 'empty', reason: 'not-found' };
    const providerMedia: ScrapeMedia = media.type === 'movie'
      ? { type: 'movie', title: media.title, releaseYear: media.year, tmdbId: String(media.tmdbId), ...(media.imdbId && { imdbId: media.imdbId }) }
      : { type: 'show', title: media.title, releaseYear: media.year, tmdbId: String(media.tmdbId), ...(media.imdbId && { imdbId: media.imdbId }), season: { number: media.season as number, tmdbId: String(media.tmdbId) }, episode: { number: media.episode as number, tmdbId: String(media.tmdbId) } };
    const output = await this.providers.discover(providerMedia, services, signal);
    if (!output) return { type: 'empty', reason: 'no-streams' };
    const headers = { ...output.stream.preferredHeaders, ...output.stream.headers };
    const common = { ...(Object.keys(headers).length && { headers }), sourceId: source.id, sourceExtractor: this.id, hostExtractor: output.embedId ?? output.sourceId, discoveredAt: new Date() };
    const streams: StreamCandidate[] = output.stream.type === 'hls'
      ? [{ url: new URL(output.stream.playlist), protocol: 'hls', ...common }]
      : Object.entries(output.stream.qualities).flatMap(([quality, file]) => file ? [{ url: new URL(file.url), protocol: 'http' as const, ...common, ...(quality !== 'unknown' && { declaredResolution: { width: Math.round(Number(quality) * 16 / 9), height: Number(quality) } }) }] : []);
    return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
  }
}
