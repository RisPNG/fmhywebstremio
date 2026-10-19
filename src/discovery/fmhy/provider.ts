import type { RequestServices } from '../../engine/core/models';
import { diffDirectory } from './diff';
import type { DirectorySnapshot, DirectorySnapshotStore, DirectoryUpdate } from './models';
import { canonicalEntryId } from './normalize';
import { parseFmhyDirectory } from './parser';

export const FMHY_DIRECTORY_URLS = [new URL('https://raw.githubusercontent.com/fmhy/edit/main/docs/video.md'), new URL('https://raw.githubusercontent.com/fmhy/edit/main/docs/non-english.md')];

export class FmhyDirectoryProvider {
  private lastKnownGood?: DirectorySnapshot;
  public constructor(private readonly services: RequestServices, private readonly urls: readonly URL[] = FMHY_DIRECTORY_URLS, private readonly store?: DirectorySnapshotStore) {}
  public async fetchSnapshot(signal: AbortSignal): Promise<DirectoryUpdate> {
    if (!this.lastKnownGood) {
      const persisted = await this.store?.load();
      if (persisted) this.lastKnownGood = persisted;
    }
    let currentUrl = this.urls[0];
    try {
      const fetchedAt = new Date();
      const responses = await Promise.allSettled(this.urls.map(url => this.services.request({ url, expectedContent: 'text', timeoutMs: 15000 }, signal)));
      const entries = new Map<string, DirectorySnapshot['entries'][number]>();
      for (const [index, response] of responses.entries()) {
        currentUrl = this.urls[index];
        if (response.status === 'rejected') throw response.reason;
        for (const entry of parseFmhyDirectory(response.value.text(), fetchedAt).entries) {
          const id = canonicalEntryId(entry.name, entry.urls);
          if (!entries.has(id)) entries.set(id, entry);
        }
      }
      const snapshot: DirectorySnapshot = { fetchedAt, entries: [...entries.values()].sort((a, b) => a.section.localeCompare(b.section) || a.name.localeCompare(b.name)) };
      const diff = diffDirectory(this.lastKnownGood, snapshot);
      this.lastKnownGood = snapshot;
      await this.store?.save(snapshot);
      return { ok: true, snapshot, diff };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes('DIRECTORY_') ? message.match(/DIRECTORY_[A-Z_]+/)?.[0] as 'DIRECTORY_FORMAT_CHANGED' | 'DIRECTORY_CATEGORY_MISSING' | 'DIRECTORY_PARSE_PARTIAL' : 'DIRECTORY_FETCH_FAILED';
      return { ok: false, failure: { code: code ?? 'DIRECTORY_FETCH_FAILED', message, stage: 'stage:directory', observedAt: new Date(), diagnostic: { sensitivity: 'privileged', ...(currentUrl && { finalUrl: currentUrl.href }), bodyCaptured: false } }, ...(this.lastKnownGood && { snapshot: this.lastKnownGood }) };
    }
  }
}
