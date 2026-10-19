import * as cheerio from 'cheerio';
import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface VidoraPlayerConfiguration {
  type?: string;
  id?: number;
  season?: number;
  episode?: number;
  title?: string;
  embedPage?: boolean;
}

interface VidoraSource {
  url?: string;
  type?: string;
  server?: string;
  label?: string;
  quality?: string;
  headers?: Readonly<Record<string, string>>;
  gen?: number;
  subtitles?: readonly { url?: string; label?: string; language?: string; format?: string }[];
}

interface VidoraPlaybackEvent {
  event?: string;
  source?: VidoraSource;
  sources?: readonly VidoraSource[];
}

export interface VidoraHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal, referrer: URL): Promise<ExtractionResult>;
}

export class VidoraPlayerHostArchitecture implements VidoraHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal, referrer: URL): Promise<ExtractionResult> {
    const page = await services.request({ url: player, expectedContent: 'html', referrer, stateScope: { kind: 'host', key: player.hostname } }, signal);
    const $ = cheerio.load(page.text());
    const frames = $('script:not([src])').map((_index, element) => $(element).text()).get().flatMap((script) => {
      const payload = script.match(/^self\.__next_f\.push\((\[[\s\S]*\])\)$/)?.[1];
      if (!payload) return [];
      const frame = JSON.parse(payload) as readonly unknown[];
      return frame[0] === 1 && typeof frame[1] === 'string' ? [frame[1]] : [];
    }).join('');
    const records = new Map(frames.split('\n').flatMap((line) => {
      const record = line.match(/^([\da-f]+):(.+)$/);
      return record ? [[record[1] as string, record[2] as string] as const] : [];
    }));
    const nodes: unknown[] = [...records.values()].filter(record => record.startsWith('[')).map(record => JSON.parse(record) as unknown);
    let configured: VidoraPlayerConfiguration | undefined;
    let component: string | undefined;
    for (const node of nodes) {
      if (Array.isArray(node)) {
        const properties = node[3] as VidoraPlayerConfiguration | undefined;
        if (node[0] === '$' && typeof node[1] === 'string' && node[1].startsWith('$L') && properties?.embedPage === true) {
          configured = properties;
          component = records.get(node[1].slice(2));
          break;
        }
        nodes.push(...node);
      } else if (node && typeof node === 'object') nodes.push(...Object.values(node));
    }
    if (!configured || !component?.startsWith('I[')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Vidora player no longer declares its embedded player configuration', stage: 'stage:extraction', sourceId, extractorId: 'vidora-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: page.status, bodyCaptured: false, parserPath: 'player-configuration' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    if (configured.type !== (media.type === 'movie' ? 'movie' : 'tv') || configured.id !== media.tmdbId || configured.title?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== expectedTitle || (media.type === 'episode' && (configured.season !== media.season || configured.episode !== media.episode))) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Vidora player does not match the requested movie or episode', stage: 'stage:extraction', sourceId, extractorId: 'vidora-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-identity' } } };
    const module = JSON.parse(component.slice(1)) as readonly [number, readonly string[], string];
    let endpointPath: string | undefined;
    for (const asset of module[1]) {
      const script = await services.request({ url: new URL(asset, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
      const client = script.text();
      const endpoint = client.match(/fetch\(`([^`]+)\?\$\{[\w$]+\}`,\{signal:[^,]+,cache:"no-store"\}/)?.[1];
      if (!endpoint || !/new URLSearchParams\(\{type:[\w$]+,id:String\([\w$]+\)\}\)/.test(client) || !/2===[\w$]+&&[\w$]+\.set\("gen","2"\)/.test(client)) continue;
      endpointPath = endpoint;
      break;
    }
    if (!endpointPath) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Vidora player no longer declares its native source generations', stage: 'stage:extraction', sourceId, extractorId: 'vidora-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-client' } } };
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 40000);
    const requestSignal = AbortSignal.any([signal, controller.signal]);
    try {
      const results = await Promise.allSettled([1, 2].map(async (generation) => {
        const endpoint = new URL(endpointPath, page.finalUrl);
        endpoint.searchParams.set('type', configured.type as string);
        endpoint.searchParams.set('id', String(configured.id));
        if (media.type === 'episode') {
          endpoint.searchParams.set('season', String(configured.season));
          endpoint.searchParams.set('episode', String(configured.episode));
        }
        if (generation === 2) endpoint.searchParams.set('gen', '2');
        const response = await services.request({ url: endpoint, expectedContent: 'text', timeoutMs: 40000, referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, requestSignal);
        const sources: VidoraSource[] = [];
        let completed: readonly VidoraSource[] | undefined;
        for (const line of response.text().split(/\r?\n/)) {
          if (!line.trim()) continue;
          let payload: VidoraPlaybackEvent;
          try {
            payload = JSON.parse(line) as VidoraPlaybackEvent;
          } catch {
            continue;
          }
          if (payload.event === 'source' && payload.source) sources.push(payload.source);
          else if (payload.event === 'done' && Array.isArray(payload.sources)) completed = payload.sources;
        }
        return { generation, sources, completed };
      }));
      let selected: VidoraSource[] = [];
      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        for (const source of result.value.sources) if (!selected.some(existing => existing.server === source.server && existing.url === source.url)) selected.push(source);
      }
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value.completed) selected = selected.filter(source => source.gen !== result.value.generation).concat(result.value.completed);
      }
      const streams: StreamCandidate[] = selected.flatMap((source) => {
        if (!source.url || (source.type !== 'hls' && source.type !== 'mp4')) return [];
        const subtitles = (source.subtitles ?? []).flatMap(track => track.url ? [{ url: new URL(track.url, page.finalUrl), ...(track.label && { label: track.label }), ...(track.language && { language: track.language }), ...(track.format && { format: track.format }) }] : []);
        return [{ url: new URL(source.url, page.finalUrl), protocol: source.type === 'hls' ? 'hls' as const : 'http' as const, delivery: 'relayed' as const, ...(source.headers && { headers: source.headers }), ...(source.quality && { label: source.quality }), ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'vidora-player', discoveredAt: new Date() }];
      });
      if (streams.length) return { type: 'streams', streams };
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') throw rejected.reason;
      if (!results.some(result => result.status === 'fulfilled' && result.value.completed)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Vidora source responses did not contain playback events', stage: 'stage:extraction', sourceId, extractorId: 'vidora-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'sources' } } };
      return { type: 'empty', reason: 'no-streams' };
    } finally {
      clearTimeout(deadline);
    }
  }
}
