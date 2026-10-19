import * as cheerio from 'cheerio';
import type { ExtractionResponse, ExtractionResult, FamilyEvidence, MediaIdentity, RequestServices, SourceRecord } from '../../engine/core/models';
import type { FamilyMatch, SourceFamily, SourceProbeSnapshot } from '../../engine/health';
import { TransportFailure } from '../../engine/transport/transport-director';
import { type VidoraHostArchitecture, VidoraPlayerHostArchitecture } from '../hosts/vidora-host-architecture';

interface GreyBoxCatalog {
  id?: number;
  media_type?: string;
  title?: string;
  name?: string;
  release_date?: string;
  seasons?: readonly { season_number?: number }[];
}

interface GreyBoxSeason {
  id?: number;
  season_number?: number;
  episodes?: readonly { episode_number?: number }[];
}

export class GreyBoxFamily implements SourceFamily {
  public readonly id = 'greybox';

  public constructor(private readonly host: VidoraHostArchitecture = new VidoraPlayerHostArchitecture()) {}

  public classify(_source: SourceRecord, snapshot: SourceProbeSnapshot): FamilyMatch | null {
    const $ = cheerio.load(snapshot.htmlSample ?? '');
    const evidence: FamilyEvidence[] = [];
    if (/^Greybox\s*[–—-]/i.test($('title').text())) evidence.push({ type: 'script-signature', fingerprint: 'greybox-brand' });
    if ($('#embed-frame').length) evidence.push({ type: 'dom-shape', fingerprint: 'greybox-embedded-player' });
    const scripts = $('script[src]').map((_index, element) => $(element).attr('src')).get();
    if (scripts.some(path => /^\/js\/embed-sources\.config\.js(?:\?|$)/.test(path))
      && scripts.some(path => /^\/js\/source-resolver\.js(?:\?|$)/.test(path))
      && scripts.some(path => /^\/js\/stream\.js(?:\?|$)/.test(path))) evidence.push({ type: 'asset-path', value: 'greybox-source-registry' });
    return evidence.length === 3 ? { familyId: this.id, confidence: 1, evidence } : null;
  }

  public async discoverMedia(media: MediaIdentity, source: SourceRecord, services: RequestServices, signal: AbortSignal): Promise<ExtractionResult> {
    if (!media.title || !media.tmdbId || (media.type === 'episode' && (!media.season || !media.episode))) return { type: 'empty', reason: 'not-found' };
    const type = media.type === 'movie' ? 'movie' : 'tv';
    const detail = new URL(`/${type}/${media.tmdbId}`, source.probe?.finalUrl ?? `https://${source.canonicalDomain}/`);
    const page = await services.request({ url: detail, expectedContent: 'html', stateScope: { kind: 'source', key: source.id } }, signal);
    let response: ExtractionResponse;
    try {
      response = await services.request({ url: new URL(`/api/${type}/${media.tmdbId}`, page.finalUrl), expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
    } catch (error) {
      if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
      throw error;
    }
    const catalog = response.json() as GreyBoxCatalog;
    if (typeof catalog.id !== 'number' || typeof catalog.media_type !== 'string' || typeof (catalog.title ?? catalog.name) !== 'string') return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'GreyBox detail response no longer contains its catalog identity', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'id/media_type/title' } } };
    if (catalog.id !== media.tmdbId || catalog.media_type !== type
      || (catalog.title ?? catalog.name)?.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() !== media.title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
      || (media.type === 'movie' && media.year !== undefined && Number(catalog.release_date?.slice(0, 4)) !== media.year)) return { type: 'empty', reason: 'not-found' };
    if (media.type === 'episode') {
      if (!Array.isArray(catalog.seasons)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'GreyBox TV detail response no longer contains seasons', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: response.status, bodyCaptured: false, parserPath: 'seasons' } } };
      if (!catalog.seasons.some(season => season.season_number === media.season)) return { type: 'empty', reason: 'not-found' };
      let seasonResponse: ExtractionResponse;
      try {
        seasonResponse = await services.request({ url: new URL(`/api/tv/${media.tmdbId}/season/${media.season}`, page.finalUrl), expectedContent: 'json', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal);
      } catch (error) {
        if (error instanceof TransportFailure && error.failure.code === 'HTTP_NOT_FOUND') return { type: 'empty', reason: 'not-found' };
        throw error;
      }
      const season = seasonResponse.json() as GreyBoxSeason;
      if (typeof season.id !== 'number' || typeof season.season_number !== 'number' || !Array.isArray(season.episodes)) return { type: 'failure', failure: { code: 'RESPONSE_SCHEMA_CHANGED', message: 'GreyBox season response no longer contains its identity and episodes', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: seasonResponse.status, bodyCaptured: false, parserPath: 'id/season_number/episodes' } } };
      if (season.id !== media.tmdbId || season.season_number !== media.season || !season.episodes.some(episode => episode.episode_number === media.episode)) return { type: 'empty', reason: 'not-found' };
    }
    const $ = cheerio.load(page.text());
    const scripts = $('script[src]').map((_index, element) => $(element).attr('src')).get();
    const registryPath = scripts.find(path => /^\/js\/embed-sources\.config\.js(?:\?|$)/.test(path));
    const streamPath = scripts.find(path => /^\/js\/stream\.js(?:\?|$)/.test(path));
    if (!registryPath || !streamPath) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'GreyBox page no longer declares its provider configuration', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', status: page.status, bodyCaptured: false, parserPath: 'provider-assets' } } };
    const [registry, stream] = await Promise.all([
      services.request({ url: new URL(registryPath, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal),
      services.request({ url: new URL(streamPath, page.finalUrl), expectedContent: 'text', referrer: page.finalUrl, stateScope: { kind: 'source', key: source.id } }, signal),
    ]);
    const registryBody = registry.text().match(/\bvar\s+registry\s*=\s*\{[\s\S]*?\bproviders:\s*\[([\s\S]*?)\n\s*\]\s*\n\s*\};/)?.[1];
    const embed = stream.text().match(/\bconst\s+EMBED\s*=\s*\{([\s\S]*?)\n\s*\};/)?.[1];
    if (!registryBody || !embed) return { type: 'failure', failure: { code: 'PAGE_STRUCTURE_CHANGED', message: 'GreyBox client no longer declares its provider registry and EMBED slot', stage: 'stage:discovery', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'registry.providers/EMBED' } } };
    const providers = [...registryBody.matchAll(/\{\s*id:\s*(['"])([^'"]+)\1,([\s\S]*?)\n\s*\}/g)].map((match) => {
      const body = match[3] as string;
      const template = body.match(new RegExp(`^\\s*${type === 'movie' ? 'movieTemplate' : 'tvTemplate'}:\\s*(['"])([^'"]+)\\1`, 'm'))?.[2];
      const supports = body.match(/^\s*supports:\s*\{([^}]*)\}/m)?.[1];
      return { body, template, enabled: !/^\s*enabled:\s*false/m.test(body), supported: supports ? new RegExp(`\\b${type}:\\s*true\\b`).test(supports) : Boolean(template), priority: Number(body.match(/^\s*priority:\s*(\d+)/m)?.[1] ?? 1000) };
    }).filter(provider => provider.enabled && provider.supported).sort((left, right) => left.priority - right.priority);
    const base = embed.match(/^\s*base:\s*(['"])([^'"]*)\1/m)?.[2]?.trim().replace(/\/+$/, '');
    const path = embed.match(new RegExp(`^\\s*${type === 'movie' ? 'moviePath' : 'episodePath'}:\\s*(['"])([^'"]*)\\1`, 'm'))?.[2];
    let template = providers[0]?.template;
    if (/^\s*embedSlot:\s*true/m.test(providers[0]?.body ?? '') && base && !/example\.com/i.test(base) && path) template = `${base}${path}`;
    if (!template) return { type: 'empty', reason: 'no-streams' };
    const values: Readonly<Record<string, number | undefined>> = { id: media.tmdbId, tmdb_id: media.tmdbId, season: media.season, episode: media.episode };
    const resolved = template.replace(/\{([A-Za-z0-9_]+)\}/g, (token, name: string) => values[name] === undefined ? token : encodeURIComponent(String(values[name])));
    const player = URL.canParse(resolved) ? new URL(resolved) : undefined;
    if (/\{[A-Za-z0-9_]+\}|\s/.test(resolved) || !player || player.protocol !== 'https:' || player.username || player.password) return { type: 'failure', failure: { code: 'EMBED_NOT_FOUND', message: 'GreyBox configured provider no longer resolves the requested media', stage: 'stage:extraction', sourceId: source.id, familyId: this.id, observedAt: new Date(), diagnostic: { sensitivity: 'privileged', bodyCaptured: false, parserPath: 'provider-template' } } };
    return this.host.discover(media, player, source.id, this.id, services, signal, page.finalUrl);
  }
}
