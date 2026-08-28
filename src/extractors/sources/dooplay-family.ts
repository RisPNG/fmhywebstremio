import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';

export class DooplayFamily implements SourceFamily {
  public readonly id = 'dooplay';
  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const evidence: FamilyEvidence[] = [];
    if (snapshot.assetPaths.some(path => /\/wp-content\/themes\/(?:dooplay|dooplay-child)/i.test(path))) evidence.push({ type: 'asset-path', value: '/wp-content/themes/dooplay' });
    if (snapshot.routeHints.some(path => /\/(?:movies?|tvshows?|episodes?)\//i.test(path))) evidence.push({ type: 'route-shape', value: '/movie|tvshows|episodes/' });
    if (snapshot.htmlSample && /dooplay|doo_player|wp-json\/dooplayerv2/i.test(snapshot.htmlSample)) evidence.push({ type: 'script-signature', fingerprint: 'dooplay-player' });
    if (!evidence.length) return null;
    return { familyId: this.id, confidence: Math.min(1, 0.45 + evidence.length * 0.2), evidence };
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    const query = new URL(`https://${source.canonicalDomain}/`);
    query.searchParams.set('s', `${media.title}${media.year ? ` ${media.year}` : ''}`);
    const response = await services.request({ url: query, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(response.text());
    const candidates = $('article,.result-item,.search-page .item').map((_index, element) => {
      const anchor = $(element).find('a[href]').first();
      return { href: anchor.attr('href'), title: (anchor.attr('title') || $(element).find('h2,h3,.title').first().text() || $(element).find('img[alt]').first().attr('alt') || $(element).text()).trim() };
    }).get().filter(value => value.href);
    const normalizedTitle = media.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const winner = candidates.find(value => value.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').includes(normalizedTitle));
    if (!winner?.href) return { type: 'empty', reason: 'not-found' };
    let contentUrl = new URL(winner.href, response.finalUrl);
    let referrer = response.finalUrl;
    if (media.type === 'episode') {
      const series = await services.request({ url: contentUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
      const seriesPage = cheerio.load(series.text());
      const season = seriesPage('a[href]').map((_index, element) => seriesPage(element).attr('href')).get().filter((href): href is string => Boolean(href)).find(href => new RegExp(`(?:season|seasons|temporada)[-_/ ]*${media.season}(?:[/?#-]|$)`, 'i').test(href));
      if (!season) return { type: 'empty', reason: 'not-found' };
      const seasonUrl = new URL(season, series.finalUrl);
      const episodes = await services.request({ url: seasonUrl, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
      const seasonPage = cheerio.load(episodes.text());
      const episode = seasonPage('a[href]').map((_index, element) => seasonPage(element).attr('href')).get().filter((href): href is string => Boolean(href)).find(href => new RegExp(`(?:episode|episodes|capitulo)[-_/ ]*${media.episode}(?:[/?#-]|$)`, 'i').test(href));
      if (!episode) return { type: 'empty', reason: 'not-found' };
      contentUrl = new URL(episode, episodes.finalUrl);
      referrer = episodes.finalUrl;
    }
    return { type: 'redirect', target: { url: contentUrl, kind: 'source-page', media, referrer, hints: { sourceId: source.id, sourceExtractor: this.id } } };
  }
}
