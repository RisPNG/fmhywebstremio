import { createDecipheriv, createHash } from 'node:crypto';
import * as cheerio from 'cheerio';
import type { ExtractionResult, ExtractorFailure, MediaIdentity, RequestServices, StreamCandidate } from '../../engine/core/models';

interface XpassServer { url?: string; name?: string }
interface XpassPlaylistItem {
  sources?: readonly { file?: string; type?: string; label?: string }[];
  tracks?: readonly { file?: string; label?: string; language?: string; kind?: string }[];
}

export interface XpassHostArchitecture {
  discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult>;
}

export class XpassPlayerHostArchitecture implements XpassHostArchitecture {
  public async discover(media: MediaIdentity, player: URL, sourceId: string, sourceExtractor: string, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const route = media.type === 'movie' ? `movie/${media.tmdbId}` : `tv/${media.tmdbId}/${media.season}/${media.episode}`;
    const page = await services.request({ url: player, expectedContent: 'html', stateScope: { kind: 'host', key: player.hostname } }, signal);
    const $ = cheerio.load(page.text());
    const dataPath = page.text().match(/\bvar\s+dataUrl="([^"]+)"/)?.[1];
    const bootstrap = $('script[src]').map((_index, element) => $(element).attr('src')).get().find(path => /^\/static\/mainmini\.js(?:\?|$)/.test(path));
    if (!dataPath || !bootstrap) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Xpass player no longer declares its data endpoint and playback loader', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-configuration' } } };
    const endpoint = new URL(dataPath, page.finalUrl);
    const ticket = endpoint.searchParams.get('token');
    if (page.finalUrl.pathname !== `/e/${route}` || endpoint.origin !== page.finalUrl.origin || endpoint.pathname !== `/data/${route}`) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'Xpass player data does not match the requested movie or episode', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'player-route' } } };
    const loader = await services.request({ url: new URL(bootstrap, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
    const playbackAsset = [...loader.text().matchAll(/['"]([A-Za-z0-9+/=]+)['"]/g)].map(match => Buffer.from((match[1] as string).replace(/[A-Za-z]/g, character => character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()), 'base64').toString('utf8')).find(value => /^\/static\/[^?#]+\.js(?:\?t=\d+)?$/.test(value));
    if (!playbackAsset || !ticket) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Xpass loader no longer declares its playback asset and data ticket', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'playback-loader' } } };
    const script = await services.request({ url: new URL(playbackAsset, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
    const configuration = [...script.text().matchAll(/['"]([A-Za-z0-9+/=]+)['"]/g)].map(match => Buffer.from((match[1] as string).replace(/[A-Za-z]/g, character => character === character.toLowerCase() ? character.toUpperCase() : character.toLowerCase()), 'base64').toString('utf8'));
    const build = configuration.find(value => /^spv3-build-\d+-[a-f0-9]+$/.test(value));
    if (!build || !configuration.includes('spv3-data-response|')) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'Xpass playback asset no longer declares its encrypted data contract', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'playback-envelope' } } };
    const response = await services.request({ url: endpoint, expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal);
    let servers: readonly XpassServer[];
    try {
      const envelope = Buffer.from(response.text().trim(), 'base64url');
      const key = createHash('sha256').update(`spv3-data-response|${build}|${endpoint.pathname}|${ticket}`).digest();
      const decipher = createDecipheriv('aes-256-gcm', key, envelope.subarray(0, 12));
      decipher.setAuthTag(envelope.subarray(-16));
      servers = JSON.parse(Buffer.concat([decipher.update(envelope.subarray(12, -16)), decipher.final()]).toString('utf8')) as readonly XpassServer[];
    } catch {
      return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Xpass data response could not be authenticated and decoded', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'data-envelope' } } };
    }
    if (!Array.isArray(servers)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Xpass data response did not contain its server list', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: page.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'servers' } } };
    const playlists = await Promise.allSettled(servers.flatMap(server => server.url ? [services.request({ url: new URL(server.url, page.finalUrl), expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'host', key: page.finalUrl.hostname } }, signal)] : []));
    const streams: StreamCandidate[] = [];
    let failure: ExtractorFailure | undefined;
    let transportError: unknown;
    for (const playlist of playlists) {
      if (playlist.status === 'rejected') {
        transportError = playlist.reason;
        continue;
      }
      const payload = playlist.value.json() as { playlist?: readonly XpassPlaylistItem[] } | readonly XpassPlaylistItem[];
      const items = Array.isArray(payload) ? payload as readonly XpassPlaylistItem[] : (payload as { playlist?: readonly XpassPlaylistItem[] }).playlist;
      if (!Array.isArray(items)) {
        failure = { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Xpass server response did not contain its playlist', stage: 'stage:extraction', sourceId, extractorId: 'xpass-player', targetHost: playlist.value.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'playlist' } };
        continue;
      }
      const noReferrer = configuration.includes('bcdn.hakunaymatata.com') && (items as readonly XpassPlaylistItem[]).some(item => item.sources?.some(source => source.file && new URL(source.file, playlist.value.finalUrl).hostname === 'bcdn.hakunaymatata.com'));
      for (const item of items as readonly XpassPlaylistItem[]) {
        const subtitles = (item.tracks ?? []).flatMap(track => track.file && track.kind === 'captions' ? [{ url: new URL(track.file, playlist.value.finalUrl), ...(track.label && { label: track.label }), ...(track.language && { language: track.language }) }] : []);
        for (const source of item.sources ?? []) {
          if (!source.file) continue;
          const url = new URL(source.file, playlist.value.finalUrl);
          streams.push({ url, protocol: source.type === 'hls' || /\.m3u8(?:$|\?)/i.test(url.href) ? 'hls' : source.type === 'dash' || /\.mpd(?:$|\?)/i.test(url.href) ? 'dash' : 'http', delivery: 'relayed', ...(!noReferrer && { headers: { referer: new URL('/', page.finalUrl).href } }), ...(source.label && { label: source.label }), ...(subtitles.length && { subtitles }), sourceId, sourceExtractor, hostExtractor: 'xpass-player', discoveredAt: new Date() });
        }
      }
    }
    if (streams.length) return { type: 'streams', streams };
    if (failure) return { type: 'failure', failure };
    if (transportError) throw transportError;
    return { type: 'empty', reason: 'no-streams' };
  }
}
