import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';

interface CineforkPlayback {
  id?: string | number;
  tmdbId?: string | number;
  tmdb_id?: number;
  tv_id?: number;
  title?: string;
  season?: string | number;
  episode?: string | number;
  success?: boolean;
  error?: string;
  url?: string;
  playlist?: string;
  sources?: readonly { url?: string; file?: string; type?: string; quality?: string; language?: string }[];
}

const supportedResponseTypes = ['vidfast', 'xpass', 'sources', 'lordflix'];

export class CineforkFamily implements SourceFamily {
  public readonly id = 'cinefork';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if ($('title').text().trim().toLowerCase() === 'cinefork') evidence.push({ type: 'script-signature', fingerprint: 'cinefork-brand' });
    if ($('script[src="/config.js"]').length) evidence.push({ type: 'dom-shape', fingerprint: 'cinefork-runtime-config' });
    if ($('#root').length && $('script[type="module"][src^="/assets/index-"]').length) evidence.push({ type: 'asset-path', value: 'cinefork-vite-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const home = await services.request({ url: new URL(`https://${source.canonicalDomain}/`), expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const client = cheerio.load(home.text())('script[type="module"][src]').attr('src');
    const asset = client ? await services.request({ url: new URL(client, home.finalUrl), expectedContent: 'text', referrer: home.finalUrl, maxBytes: 2 * 1024 * 1024, stateScope: { kind: 'source', key: source.id } }, signal) : undefined;
    const servers = [...(asset?.text() ?? '').matchAll(/\{name:"[^"]+",base:"(\/api\/ext\/[^"]+)",path:"([^"]+)",tvPath:"([^"]+)",responseType:"([^"]+)"[^{}]*?mediaTypes:\[([^\]]*)\]\}/g)]
      .filter(server => supportedResponseTypes.includes(server[4] as string) && (server[5] as string).includes(media.type === 'movie' ? '"movie"' : '"show"'));
    if (!servers.length) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Cinefork application no longer declares its playback servers', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: home.status, bodyCaptured: false, parserPath: 'client-servers' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const headers = { Accept: 'application/json', origin: home.finalUrl.origin, referer: home.finalUrl.href };
    const results = await Promise.allSettled(servers.map(async (server): Promise<ExtractionResult> => {
      const playbackUrl = new URL(((media.type === 'movie' ? server[2] : server[3]) as string).replace('{id}', String(media.tmdbId)).replace('{season}', String(media.season)).replace('{episode}', String(media.episode)), home.finalUrl);
      let response: ExtractionResponse;
      try {
        response = await services.request({ url: playbackUrl, expectedContent: 'json', headers, referrer: home.finalUrl, timeoutMs: 15000, stateScope: { kind: 'source', key: source.id } }, signal);
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
        throw error;
      }
      const payload = response.json() as CineforkPlayback;
      if (payload.success === false || payload.error) return { type: 'empty', reason: 'no-streams' };
      if (Number(payload.tmdbId ?? payload.tmdb_id ?? payload.tv_id ?? payload.id) !== media.tmdbId
        || (payload.title !== undefined && payload.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== expectedTitle)
        || (media.type === 'episode' && (Number(payload.season) !== media.season || Number(payload.episode) !== media.episode))) return { type: 'empty', reason: 'not-found' };
      const provider = (server[1] as string).split('/').at(-1);
      const entries: readonly { url?: string | undefined; quality?: string | undefined; language?: string | undefined }[] = server[4] === 'vidfast' ? [{ url: payload.url }] : server[4] === 'lordflix' ? [{ url: payload.playlist }] : (payload.sources ?? []).map(entry => ({ url: entry.file ?? entry.url, quality: entry.quality, language: entry.language }));
      const streams: StreamCandidate[] = entries.flatMap((entry) => {
        if (!entry.url) return [];
        const height = Number(entry.quality?.match(/\d+/)?.[0]);
        return [{ url: new URL(entry.url, response.finalUrl), protocol: 'hls' as const, delivery: 'relayed' as const, headers: { origin: home.finalUrl.origin, referer: home.finalUrl.href }, ...(entry.language && { language: entry.language }), ...(height > 0 && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), ...(entry.quality && { label: entry.quality }), sourceId: source.id, sourceExtractor: this.id, hostExtractor: `${provider}-api`, discoveredAt: new Date() }];
      });
      return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
    }));
    const streams = results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []);
    if (streams.length) return { type: 'streams', streams };
    const rejected = results.find(result => result.status === 'rejected');
    if (rejected?.status === 'rejected' && results.every(result => result.status === 'rejected')) throw rejected.reason;
    return { type: 'empty', reason: 'no-streams' };
  }
}
