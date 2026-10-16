import * as cheerio from 'cheerio';
import type { ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { VidsparkApiHostArchitecture, type VidsparkHostArchitecture } from '../hosts/vidspark-host-architecture';

export class PressPlayXFamily implements SourceFamily {
  public readonly id = 'pressplayx';

  public constructor(private readonly host: VidsparkHostArchitecture = new VidsparkApiHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^PressPlayX\s*\|/.test($('title').text())) evidence.push({ type: 'script-signature', fingerprint: 'pressplayx-brand' });
    if (/^Astro\b/.test($('meta[name="generator"]').attr('content') ?? '') && $('script[type="module"][src^="/_astro/"]').length) evidence.push({ type: 'generator-meta', value: 'pressplayx-astro' });
    if ($('a[href^="/watch/"]').toArray().some(element => /^\/watch\/(?:movie|tv)-[a-z0-9-]+-[a-z0-9]{5}$/.test($(element).attr('href') ?? ''))) evidence.push({ type: 'route-shape', value: 'pressplayx-watch-slug' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const search = new URL('/explore', `https://${source.canonicalDomain}/`);
    search.searchParams.set('q', media.title);
    const results = await services.request({ url: search, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    const $ = cheerio.load(results.text());
    const expectedTitle = media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    const pages = $(`a[href^="/watch/${media.type === 'movie' ? 'movie' : 'tv'}-"]`).toArray().filter(element => $(element).find('img').attr('alt')?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() === expectedTitle).map(element => new URL($(element).attr('href') as string, results.finalUrl));
    for (const page of pages) {
      if (media.type === 'episode') {
        page.searchParams.set('season', String(media.season));
        page.searchParams.set('episode', String(media.episode));
      }
      const watch = await services.request({ url: page, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
      const player = cheerio.load(watch.text())('iframe#player-video').attr('src');
      if (!player) continue;
      const url = new URL(player, watch.finalUrl);
      if (url.pathname !== (media.type === 'movie' ? `/movie/${media.tmdbId}` : `/tv/${media.tmdbId}-${media.season}-${media.episode}`)) continue;
      return this.host.discover(media, url, source.id, this.id, services, signal);
    }
    return { type: 'empty', reason: 'not-found' };
  }
}
