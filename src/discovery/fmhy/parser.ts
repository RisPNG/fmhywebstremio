import type { DirectorySnapshot, FmhyDirectoryEntry } from './models';
import { normalizeDirectoryUrl } from './normalize';

const RELEVANT = /(?:movies?|tv|stream(?:ing)?|anime|video)/i;

export function parseFmhyDirectory(input: string, fetchedAt = new Date()): DirectorySnapshot {
  if (!input.trim()) throw new Error('DIRECTORY_FORMAT_CHANGED');
  if (input.trimStart().startsWith('{') || input.trimStart().startsWith('[')) return parseJson(input, fetchedAt);
  let section = '';
  const entries: FmhyDirectoryEntry[] = [];
  let relevantSectionSeen = false;
  let relevantRoot = false;
  let invalidLinks = 0;
  for (const line of input.replace(/\r/g, '').split('\n')) {
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading?.[2]) {
      section = heading[2].replace(/[*_`]/g, '').trim();
      if (heading[1]?.length === 1) relevantRoot = RELEVANT.test(section);
      if (relevantRoot || RELEVANT.test(section)) relevantSectionSeen = true;
      continue;
    }
    if ((!relevantRoot && !RELEVANT.test(section)) || !/^\s*(?:[-*+] |\d+\. )/.test(line)) continue;
    const resourceGroup = line.split(/\s+-\s+/, 1)[0] ?? line;
    const declaredLinks = [...resourceGroup.matchAll(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)];
    const links = declaredLinks.filter(match => /^https?:\/\//i.test(match[2] as string));
    const bare = [...resourceGroup.matchAll(/(?<!\]\()https?:\/\/[^\s)>]+/g)].map(match => ['', match[0], match[0]] as unknown as RegExpMatchArray);
    const found = [...links, ...bare];
    invalidLinks += declaredLinks.length - links.length;
    if (!found.length) continue;
    const urls = found.map(match => normalizeDirectoryUrl(match[2] as string)).filter((url): url is URL => url !== null);
    invalidLinks += found.length - urls.length;
    if (!urls.length) continue;
    const name = String(found[0]?.[1] || urls[0]?.hostname).replace(/^(?:⭐|🌐|↪️|\s)+/u, '').trim();
    const unique = [...new Map(urls.map(url => [url.hostname, url])).values()];
    const tags = [...new Set([...(line.includes('⭐') ? ['recommended'] : []), ...(line.includes('🌐') ? ['index'] : []), ...(line.match(/`([^`]+)`/g) ?? []).map(tag => tag.replace(/`/g, ''))])].sort();
    entries.push({ name, urls: unique, section, tags, mirrors: unique.slice(1), apiHint: /\bapi\b/i.test(line) });
  }
  if (!relevantSectionSeen) throw new Error('DIRECTORY_CATEGORY_MISSING');
  if (!entries.length) throw new Error('DIRECTORY_FORMAT_CHANGED');
  if (invalidLinks > Math.max(3, entries.length / 4)) throw new Error('DIRECTORY_PARSE_PARTIAL');
  entries.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name) || (a.urls[0]?.href ?? '').localeCompare(b.urls[0]?.href ?? ''));
  return { fetchedAt, entries };
}

function parseJson(input: string, fetchedAt: Date): DirectorySnapshot {
  const raw = JSON.parse(input) as unknown;
  const records = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'entries' in raw ? (raw as { entries: unknown }).entries : undefined;
  if (!Array.isArray(records)) throw new Error('DIRECTORY_FORMAT_CHANGED');
  const entries = records.flatMap((record): FmhyDirectoryEntry[] => {
    if (!record || typeof record !== 'object') return [];
    const value = record as Record<string, unknown>;
    const section = String(value['section'] ?? value['category'] ?? '');
    if (!RELEVANT.test(section)) return [];
    const values = Array.isArray(value['urls']) ? value['urls'] : typeof value['url'] === 'string' ? [value['url']] : [];
    const urls = values.map(String).map(normalizeDirectoryUrl).filter((url): url is URL => url !== null);
    if (!urls.length) return [];
    return [{ name: String(value['name'] ?? urls[0]?.hostname), urls, section, tags: Array.isArray(value['tags']) ? value['tags'].map(String).sort() : [], mirrors: urls.slice(1), apiHint: Boolean(value['apiHint']) }];
  });
  if (!entries.length) throw new Error('DIRECTORY_CATEGORY_MISSING');
  entries.sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name));
  return { fetchedAt, entries };
}
