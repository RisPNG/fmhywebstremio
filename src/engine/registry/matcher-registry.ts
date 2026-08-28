import type { ExtractionTarget, Extractor } from '../core/models';
import type { ExtractorMetadata, RegistryMatch } from './types';

export class MatcherRegistry {
  public constructor(private readonly entries: readonly ExtractorMetadata[]) {}

  public match(target: ExtractionTarget): RegistryMatch | null {
    const matches: RegistryMatch[] = [];
    for (const metadata of this.entries) {
      for (const matcher of metadata.matchers) {
        if (matcher.protocols && !matcher.protocols.includes(target.url.protocol.replace(':', ''))) continue;
        if (matcher.hostname && target.url.hostname !== matcher.hostname && !target.url.hostname.endsWith(`.${matcher.hostname}`)) continue;
        const path = matcher.path ? new RegExp(matcher.path).exec(target.url.pathname) : null;
        if (matcher.path && !path) continue;
        const captures = path?.groups;
        matches.push({ metadata, matcher, confidence: matcher.priority, ...(captures && { captures }) });
      }
    }
    matches.sort((a, b) => b.confidence - a.confidence || a.metadata.id.localeCompare(b.metadata.id) || a.matcher.id.localeCompare(b.matcher.id));
    return matches[0] ?? null;
  }

  public async load(target: ExtractionTarget): Promise<{ extractor: Extractor; match: RegistryMatch } | null> {
    const match = this.match(target);
    if (!match) return null;
    const module = await match.metadata.load();
    return { extractor: new module.default(), match };
  }

  public collisions(urls: readonly string[]): Readonly<Record<string, readonly string[]>> {
    const result: Record<string, string[]> = {};
    for (const value of urls) {
      const url = new URL(value);
      const ids = this.entries.flatMap(entry => entry.matchers.filter(matcher =>
        (!matcher.protocols || matcher.protocols.includes(url.protocol.replace(':', '')))
        && (!matcher.hostname || url.hostname === matcher.hostname || url.hostname.endsWith(`.${matcher.hostname}`))
        && (!matcher.path || new RegExp(matcher.path).test(url.pathname)),
      ).map(matcher => `${entry.id}:${matcher.id}`));
      if (ids.length > 1) result[value] = ids;
    }
    return result;
  }
}

export class RegistryExtractorLookup {
  public constructor(private readonly registry: MatcherRegistry) {}
  public async find(target: ExtractionTarget): Promise<Extractor | null> { return (await this.registry.load(target))?.extractor ?? null; }
}
