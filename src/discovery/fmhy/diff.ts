import type { DirectoryDiff, DirectorySnapshot } from './models';
import { canonicalEntryId } from './normalize';

export function diffDirectory(previous: DirectorySnapshot | undefined, next: DirectorySnapshot): DirectoryDiff[] {
  if (!previous) return next.entries.map(entry => ({ type: 'SOURCE_ADDED', source: canonicalEntryId(entry.name, entry.urls) }));
  const before = new Map(previous.entries.map(entry => [canonicalEntryId(entry.name, entry.urls), entry]));
  const after = new Map(next.entries.map(entry => [canonicalEntryId(entry.name, entry.urls), entry]));
  const changes: DirectoryDiff[] = [];
  for (const [id, entry] of after) {
    const old = before.get(id);
    if (!old) {
      changes.push({ type: 'SOURCE_ADDED', source: id });
      continue;
    }
    const oldDomains = new Set(old.urls.map(url => url.hostname));
    const newDomains = new Set(entry.urls.map(url => url.hostname));
    for (const domain of newDomains) if (!oldDomains.has(domain)) changes.push({ type: 'DOMAIN_ADDED', source: id, domain });
    for (const domain of oldDomains) if (!newDomains.has(domain)) changes.push({ type: 'DOMAIN_REMOVED', source: id, domain });
    if (old.section !== entry.section || JSON.stringify(old.tags) !== JSON.stringify(entry.tags) || old.apiHint !== entry.apiHint) changes.push({ type: 'METADATA_CHANGED', source: id });
  }
  for (const id of before.keys()) if (!after.has(id)) changes.push({ type: 'SOURCE_REMOVED', source: id });
  return changes.length ? changes.sort((a, b) => a.source.localeCompare(b.source) || a.type.localeCompare(b.type) || (a.domain ?? '').localeCompare(b.domain ?? '')) : [{ type: 'UNCHANGED', source: '*' }];
}
