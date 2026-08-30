import type { DirectorySnapshot } from '../../discovery/fmhy';
import { canonicalEntryId } from '../../discovery/fmhy';
import type { SourceHealthHistory, SourceRecord } from '../core/models';

export interface SourceRegistryState { records: readonly SourceRecord[]; health: readonly SourceHealthHistory[] }

export class SourceRegistry {
  private readonly records = new Map<string, SourceRecord>();
  private readonly history = new Map<string, SourceHealthHistory>();

  public apply(snapshot: DirectorySnapshot): readonly SourceRecord[] {
    const seen = new Set<string>();
    for (const entry of snapshot.entries) {
      const id = canonicalEntryId(entry.name, entry.urls);
      seen.add(id);
      const existing = this.records.get(id);
      const domains = [...new Set(entry.urls.map(url => url.hostname))];
      this.records.set(id, {
        id, canonicalDomain: domains[0] ?? entry.urls[0]?.hostname ?? id, aliases: domains.slice(1),
        fmhy: { section: entry.section, tags: entry.tags, firstSeenAt: existing?.fmhy.firstSeenAt ?? snapshot.fetchedAt, lastSeenAt: snapshot.fetchedAt },
        ...(existing?.family && { family: existing.family }), ...(existing?.probe && { probe: existing.probe }), status: existing?.status ?? 'unknown',
      });
    }
    for (const [id, record] of this.records) if (!seen.has(id) && record.status !== 'disabled') this.records.set(id, { ...record, status: 'unsupported' });
    return this.list();
  }

  public list(statuses?: readonly SourceRecord['status'][]): SourceRecord[] { return [...this.records.values()].filter(record => !statuses || statuses.includes(record.status)).sort((a, b) => a.id.localeCompare(b.id)); }
  public runtimeEligible(): SourceRecord[] {
    return this.list(['supported']).filter((source) => {
      const health = this.history.get(source.id);
      return Boolean(health && health.lastOutcome === 'healthy' && health.recentSuccesses > 0);
    });
  }

  public get(id: string): SourceRecord | undefined { return this.records.get(id); }
  public set(record: SourceRecord): void { this.records.set(record.id, record); }
  public recordHealth(value: SourceHealthHistory): void { this.history.set(value.sourceId, value); }
  public health(): ReadonlyMap<string, SourceHealthHistory> { return this.history; }

  public snapshot(): SourceRegistryState {
    return { records: this.list(), health: [...this.history.values()].sort((a, b) => a.sourceId.localeCompare(b.sourceId)) };
  }

  public restore(state: SourceRegistryState): void {
    this.records.clear();
    this.history.clear();
    for (const record of state.records) this.records.set(record.id, record);
    for (const outcome of state.health) this.history.set(outcome.sourceId, outcome);
  }
}
