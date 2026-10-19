import * as cheerio from 'cheerio';
import type { ExtractionResult, ExtractorFailure, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord, StreamCandidate } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

interface BiliBiliVideo { aid?: string; title?: string }
interface BiliBiliSearch { code?: number; data?: { modules?: readonly { type?: string; items?: readonly BiliBiliVideo[] }[] | null; has_next?: boolean } }
interface BiliBiliPlaylist { code?: number; data?: { title?: string; playlist_id?: number; items?: readonly BiliBiliVideo[] } }
interface BiliBiliInfo { code?: number; data?: { archive?: BiliBiliVideo } }
interface BiliBiliPlayback { code?: number; data?: { playurl?: { video?: readonly { video_resource?: { id?: string; url?: string; container?: number; width?: number; height?: number }; stream_info?: { desc_words?: string } }[] } } }

export class BiliBiliFamily implements SourceFamily {
  public readonly id = 'bilibili';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/\bBiliBili\b/i.test($('title').text()) && $('meta[property="og:url"]').attr('content')?.includes('bilibili.tv')) evidence.push({ type: 'script-signature', fingerprint: 'bilibili-international-brand' });
    if ($('script:not([src])').toArray().some(element => $(element).text().includes('window.__BSTAR__METADATA__='))) evidence.push({ type: 'script-signature', fingerprint: 'bilibili-bstar-metadata' });
    if ($('script[src]').toArray().some(element => /\/fe-static\/bstar-web-new\/client\/assets\/index-[\w-]+\.js$/.test($(element).attr('src') ?? ''))) evidence.push({ type: 'asset-path', value: 'bilibili-bstar-client' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (media.type !== 'episode' || !media.title || !media.year || !media.season || !media.episode) return { type: 'empty', reason: 'not-found' };
    const firstEpisode = media.episodes?.find(episode => episode.season === media.season && episode.episode === 1 && episode.title);
    const seasons = [...new Set(media.episodes?.map(episode => episode.season).filter(season => season > 0))];
    const title = media.title.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const episodeTitle = firstEpisode?.title?.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
    const queries = [...new Set([...(firstEpisode?.title ? [`${firstEpisode.title.replace(/\s+/g, '')} E1`, `${firstEpisode.title} E1`] : []), media.title])];
    const origin = new URL('/', source.probe?.finalUrl ?? `https://${source.canonicalDomain}/`);
    const visited = new Set<string>();
    const streams: StreamCandidate[] = [];
    let failure: ExtractorFailure | undefined;
    let transportError: unknown;
    for (const query of queries) {
      const search = new URL('https://api.bilibili.tv/intl/gateway/web/v2/search_v2');
      for (const [key, value] of Object.entries({ keyword: query, highlight: '1', pn: '1', ps: '20', sort: '0', duration_type: '0', s_locale: 'en_US' })) search.searchParams.set(key, value);
      const response = await services.request({ url: search, expectedContent: 'json', referrer: origin, stateScope: { kind: 'source', key: source.id } }, signal);
      const catalog = response.json() as BiliBiliSearch;
      if (catalog.code === 0 && catalog.data?.modules === null && catalog.data.has_next === false) continue;
      if (catalog.code !== 0 || !Array.isArray(catalog.data?.modules)) return { type: 'failure', failure: { code: catalog.code === undefined || catalog.code === 0 ? 'RESPONSE_SCHEMA_CHANGED' : 'SEARCH_FAILED', message: `BiliBili search did not return its native video modules (API code ${catalog.code ?? 'missing'})`, stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'data.modules' } } };
      const seeds = catalog.data.modules.flatMap(module => module.type === 'ugc' ? module.items ?? [] : []).filter((video) => {
        if (!video.aid || !video.title || visited.has(video.aid)) return false;
        const episode = video.title.match(/\bE(?:pisode)?\s*0*(\d+)\b/iu);
        const season = video.title.match(/\b(?:S|Season\s*)0*(\d+)\b/iu);
        if (Number(episode?.[1]) !== 1 || (season && Number(season[1]) !== media.season)) return false;
        const name = video.title.replace(episode?.[0] ?? '', '').replace(season?.[0] ?? '', '').replace(/\b(?:19|20)\d{2}\b/g, '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        return name === title || name === episodeTitle;
      });
      const results = await Promise.allSettled(seeds.map(async (seed): Promise<ExtractionResult> => {
        const aid = seed.aid as string;
        visited.add(aid);
        const player = new URL(`/en/video/${aid}`, origin);
        const endpoint = new URL('https://api.bilibili.tv/intl/gateway/web/v2/ugc/playlist');
        endpoint.searchParams.set('aid', aid);
        const response = await services.request({ url: endpoint, expectedContent: 'json', referrer: player, stateScope: { kind: 'source', key: source.id } }, signal);
        const playlist = response.json() as BiliBiliPlaylist;
        if (playlist.code !== 0 || !Array.isArray(playlist.data?.items)) return { type: 'failure', failure: { code: playlist.code === undefined || playlist.code === 0 ? 'RESPONSE_SCHEMA_CHANGED' : 'SEARCH_FAILED', message: 'BiliBili video did not return its native playlist', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'data.items' } } };
        const collection = playlist.data.title ?? '';
        const years = [...collection.matchAll(/\b((?:19|20)\d{2})\b/g)].map(match => Number(match[1]));
        const season = collection.match(/\b(?:S|Season\s*)0*(\d+)\b/iu);
        const name = collection.replace(/\b(?:19|20)\d{2}\b/g, '').replace(season?.[0] ?? '', '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
        if (name !== title || years.length !== 1 || years[0] !== media.year || (season ? Number(season[1]) !== media.season : seasons.length !== 1 || seasons[0] !== media.season) || !playlist.data.items.some(video => video.aid === aid && video.title === seed.title)) return { type: 'empty', reason: 'not-found' };
        const episodes = playlist.data.items.filter((video) => {
          const episode = video.title?.match(/\bE(?:pisode)?\s*0*(\d+)\b/iu);
          const season = video.title?.match(/\b(?:S|Season\s*)0*(\d+)\b/iu);
          return video.aid && Number(episode?.[1]) === media.episode && (!season || Number(season[1]) === media.season);
        });
        const results = await Promise.allSettled(episodes.map(async (episode): Promise<ExtractionResult> => {
          const aid = episode.aid as string;
          const player = new URL(`/en/video/${aid}`, origin);
          const endpoint = new URL('https://api.bilibili.tv/intl/gateway/web/v2/ugc/play/info');
          endpoint.searchParams.set('aid', aid);
          const response = await services.request({ url: endpoint, expectedContent: 'json', referrer: player, stateScope: { kind: 'source', key: source.id } }, signal);
          const info = response.json() as BiliBiliInfo;
          if (info.code !== 0 || !info.data?.archive) return { type: 'failure', failure: { code: info.code === undefined || info.code === 0 ? 'RESPONSE_SCHEMA_CHANGED' : 'HOST_EXTRACTION_FAILED', message: 'BiliBili video did not return its archive metadata', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'data.archive' } } };
          if (info.data.archive.aid !== aid || info.data.archive.title !== episode.title) return { type: 'failure', failure: { code: 'RESULT_MAPPING_FAILED', message: 'BiliBili archive does not match its selected playlist episode', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'data.archive.aid/title' } } };
          const playback = new URL('https://api.bilibili.tv/intl/gateway/web/playurl');
          for (const [key, value] of Object.entries({ aid, s_locale: 'en_US', platform: 'web', qn: '64', type: '0', device: 'wap', tf: '0', force_container: '2' })) playback.searchParams.set(key, value);
          const playbackResponse = await services.request({ url: playback, expectedContent: 'json', referrer: player, stateScope: { kind: 'source', key: source.id } }, signal);
          const payload = playbackResponse.json() as BiliBiliPlayback;
          if (payload.code !== 0 || !Array.isArray(payload.data?.playurl?.video)) return { type: 'failure', failure: { code: payload.code === undefined || payload.code === 0 ? 'RESPONSE_SCHEMA_CHANGED' : 'HOST_EXTRACTION_FAILED', message: 'BiliBili playback did not return its native video resources', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: playbackResponse.status, bodyCaptured: false, parserPath: 'data.playurl.video' } } };
          const streams: StreamCandidate[] = payload.data.playurl.video.flatMap((video) => {
            const resource = video.video_resource;
            if (!resource?.url || resource.container !== 2) return [];
            return [{ url: new URL(resource.url), protocol: 'http', delivery: 'relayed', headers: { referer: new URL('/', player).href }, ...(resource.width && resource.height && { declaredResolution: { width: resource.width, height: resource.height } }), ...(resource.id && { providerContentId: resource.id }), ...(video.stream_info?.desc_words && { label: video.stream_info.desc_words }), sourceId: source.id, sourceExtractor: this.id, hostExtractor: 'bilibili-ugc', discoveredAt: new Date() }];
          });
          return streams.length ? { type: 'streams', streams } : { type: 'empty', reason: 'no-streams' };
        }));
        const streams = results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []);
        if (streams.length) return { type: 'streams', streams };
        const failure = results.find(result => result.status === 'fulfilled' && result.value.type === 'failure');
        if (failure?.status === 'fulfilled') return failure.value;
        const rejected = results.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        return { type: 'empty', reason: 'no-streams' };
      }));
      streams.push(...results.flatMap(result => result.status === 'fulfilled' && result.value.type === 'streams' ? result.value.streams : []));
      if (streams.length) return { type: 'streams', streams };
      const failed = results.find(result => result.status === 'fulfilled' && result.value.type === 'failure');
      if (failed?.status === 'fulfilled' && failed.value.type === 'failure') failure ??= failed.value.failure;
      const rejected = results.find(result => result.status === 'rejected');
      if (rejected?.status === 'rejected') transportError ??= rejected.reason;
    }
    if (failure) return { type: 'failure', failure };
    if (transportError) throw transportError;
    return { type: 'empty', reason: 'not-found' };
  }
}
