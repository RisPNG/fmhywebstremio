import { createHash } from 'node:crypto';
import type { ExtractionResult, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface OneEmbedSourceResponse {
  success?: boolean;
  selectedSource?: string;
  title?: { id?: number; tmdb_id?: string; name?: string; release_date?: string; type?: string };
  streams?: { raw_m3u8?: string; proxy_m3u8?: string; m3u8?: string; format?: string };
  qualities?: readonly { resolution?: number; rawUrl?: string }[];
}

export interface OneEmbedHostArchitecture {
  discover(media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class OneEmbedApiHostArchitecture implements OneEmbedHostArchitecture {
  public async discover(media: MediaIdentity, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const origin = new URL('https://1embed.cc/');
    const tokenResponse = await services.request({ url: new URL('/api/token', origin), expectedContent: 'json', stateScope: { kind: 'host', key: origin.hostname } }, signal);
    const tokenPayload = tokenResponse.json() as { t?: number; n?: number; s?: string };
    if (!tokenPayload.t || !tokenPayload.n || !tokenPayload.s) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: '1Embed token response did not contain a signed challenge', stage: 'stage:extraction', sourceId, extractorId: 'oneembed-api', targetHost: origin.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: tokenResponse.status, ...(tokenResponse.headers['content-type'] && { contentType: tokenResponse.headers['content-type'] }), finalUrl: tokenResponse.finalUrl.toString(), bodyCaptured: true, bodyBytes: tokenResponse.body.byteLength, parserPath: 't,n,s' } } };
    const proof = createHash('sha256').update(`${tokenPayload.n}:${tokenPayload.t}:bcine_player_guard_${tokenPayload.t % 1000}`).digest('hex').slice(0, 16);
    const token = Buffer.from(JSON.stringify({ t: tokenPayload.t, n: tokenPayload.n, s: tokenPayload.s, p: proof })).toString('base64');
    const endpoint = new URL(`/api/sources/4/id=${media.tmdbId}`, origin);
    endpoint.searchParams.set('type', media.type === 'movie' ? 'movie' : 'tv');
    endpoint.searchParams.set('title', media.title);
    if (media.type === 'episode') {
      endpoint.searchParams.set('s', String(media.season));
      endpoint.searchParams.set('e', String(media.episode));
    }
    const response = await services.request({ url: endpoint, headers: { 'X-Stream-Token': token }, expectedContent: 'json', stateScope: { kind: 'host', key: origin.hostname } }, signal);
    const payload = response.json() as OneEmbedSourceResponse;
    const payloadId = Number(payload.title?.tmdb_id ?? payload.title?.id);
    const rawUrl = [...(payload.qualities ?? [])].sort((a, b) => Number(b.resolution) - Number(a.resolution)).find(quality => quality.rawUrl)?.rawUrl ?? payload.streams?.raw_m3u8;
    const streamValues = [...new Set([rawUrl, payload.streams?.proxy_m3u8 ?? payload.streams?.m3u8].filter((value): value is string => Boolean(value)))];
    if (!payload.success || payloadId !== media.tmdbId || !streamValues.length || /warning|unauthorized/i.test(`${payload.selectedSource ?? ''} ${payload.title?.name ?? ''}`)) return { type: 'empty', reason: 'no-streams' };
    const proxyUrl = payload.streams?.proxy_m3u8 ? new URL(payload.streams.proxy_m3u8) : null;
    const headers = proxyUrl ? { ...(proxyUrl.searchParams.get('referer') && { referer: proxyUrl.searchParams.get('referer') as string }), ...(proxyUrl.searchParams.get('origin') && { origin: proxyUrl.searchParams.get('origin') as string }) } : {};
    const height = Math.max(...(payload.qualities ?? []).map(quality => Number(quality.resolution)).filter(value => value > 0), 0);
    const streams: StreamCandidate[] = streamValues.map(streamValue => ({ url: new URL(streamValue), protocol: 'hls', ...(Object.keys(headers).length && { headers }), sourceId, sourceExtractor, hostExtractor: 'oneembed-api', ...(payload.selectedSource && { label: payload.selectedSource }), ...(height && { declaredResolution: { width: Math.round(height * 16 / 9), height } }), discoveredAt: new Date() }));
    return { type: 'streams', streams };
  }
}
