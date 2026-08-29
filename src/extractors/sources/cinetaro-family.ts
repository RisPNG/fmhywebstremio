import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

interface CinetaroSearchResponse {
  results?: readonly { id?: number; media_type?: string; title?: string; name?: string; release_date?: string }[];
}

interface CinetaroServerResponse {
  hardsub?: readonly { serverId?: string; unavailable?: boolean }[];
}

export class CinetaroFamily implements SourceFamily {
  public readonly id = 'cinetaro';

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.htmlSample && /\/ajax\/search\/suggest\?keyword=|\/src\/assets\/js\/search\.js/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinetaro-search' });
    if (snapshot.htmlSample && /\/details\/|\/watch\//i.test(snapshot.htmlSample)) evidence.push({ type: 'route-shape', value: 'cinetaro-catalog-routes' });
    if (snapshot.htmlSample && /Cinetaro/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'cinetaro-brand' });
    if (evidence.length < 2) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/ajax/search/suggest', `https://${source.canonicalDomain}/`);
    search.searchParams.set('keyword', media.title);
    const watch = new URL(`/watch/${media.tmdbId}`, search);
    if (media.type === 'movie') {
      watch.searchParams.set('m', '');
      watch.searchParams.set('ep', '1');
    } else {
      watch.searchParams.set('tv', '');
      watch.searchParams.set('s', String(media.season));
      watch.searchParams.set('ep', String(media.episode));
    }
    const [response, watchResponse] = await Promise.all([
      services.request({ url: search, expectedContent: 'json', stateScope: { kind: 'source', key: source.id } }, signal),
      services.request({ url: watch, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal),
    ]);
    const payload = response.json() as CinetaroSearchResponse;
    if (!Array.isArray(payload.results)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'Cinetaro search response did not contain results', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, targetHost: source.canonicalDomain, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, finalUrl: response.finalUrl.href, bodyCaptured: true, bodyBytes: response.body.byteLength, parserPath: 'results' } } };
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const match = payload.results.find(result => (result.title ?? result.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle
      && result.media_type === (media.type === 'movie' ? 'movie' : 'tv')
      && (media.type !== 'movie' || media.year === undefined || Number.parseInt(result.release_date ?? '') === media.year));
    if (!match?.id || match.id !== media.tmdbId) return { type: 'empty', reason: 'not-found' };
    const $ = cheerio.load(watchResponse.text());
    const episodeId = $('.ssl-item.ep-item').filter((_index, element) => Number($(element).attr('data-number')) === (media.type === 'movie' ? 1 : media.episode)).first().attr('data-id');
    if (!episodeId) return { type: 'empty', reason: 'not-found' };
    const serversUrl = new URL('/src/ajax/anime/server.php', watchResponse.finalUrl);
    serversUrl.searchParams.set('episodeId', episodeId);
    const serversResponse = await services.request({ url: serversUrl, expectedContent: 'json', referrer: watchResponse.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const server = (serversResponse.json() as CinetaroServerResponse).hardsub?.find(value => value.serverId && !value.unavailable);
    if (!server?.serverId) return { type: 'empty', reason: 'no-streams' };
    const playerUrl = new URL('/src/player/sub.php', watchResponse.finalUrl);
    playerUrl.searchParams.set('id', episodeId);
    playerUrl.searchParams.set('server', server.serverId);
    playerUrl.searchParams.set('embed', 'true');
    playerUrl.searchParams.set('ep', String(media.type === 'movie' ? 1 : media.episode));
    const player = await services.request({ url: playerUrl, expectedContent: 'html', referrer: watchResponse.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    const iframe = cheerio.load(player.text())('iframe[src]').first().attr('src');
    if (!iframe) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'Cinetaro player did not contain an embed', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, targetHost: player.finalUrl.hostname, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: player.status, finalUrl: player.finalUrl.href, bodyCaptured: false } } };
    return { type: 'redirect', target: { url: new URL(iframe, player.finalUrl), kind: 'embed', referrer: player.finalUrl, media, hints: { sourceId: source.id, sourceExtractor: this.id } } };
  }
}
