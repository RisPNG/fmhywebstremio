import type { RequestServices } from '../../engine/core/models';
import { diffDirectory } from './diff';
import type { DirectorySnapshot, DirectorySnapshotStore, DirectoryUpdate } from './models';
import { parseFmhyDirectory } from './parser';

export const FMHY_DIRECTORY_URL = new URL('https://raw.githubusercontent.com/fmhy/edit/main/docs/video.md');

export class FmhyDirectoryProvider {
  private lastKnownGood?: DirectorySnapshot;
  public constructor(private readonly services: RequestServices, private readonly url = FMHY_DIRECTORY_URL, private readonly store?: DirectorySnapshotStore) {}
  public async fetchSnapshot(signal: AbortSignal): Promise<DirectoryUpdate> {
    if (!this.lastKnownGood) {
      const persisted = await this.store?.load();
      if (persisted) this.lastKnownGood = persisted;
    }
    try {
      const response = await this.services.request({ url: this.url, expectedContent: 'text', timeoutMs: 15000 }, signal);
      const snapshot = parseFmhyDirectory(response.text(), new Date());
      const diff = diffDirectory(this.lastKnownGood, snapshot);
      this.lastKnownGood = snapshot;
      await this.store?.save(snapshot);
      return { ok: true, snapshot, diff };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = message.includes('DIRECTORY_') ? message.match(/DIRECTORY_[A-Z_]+/)?.[0] as 'DIRECTORY_FORMAT_CHANGED' | 'DIRECTORY_CATEGORY_MISSING' | 'DIRECTORY_PARSE_PARTIAL' : 'DIRECTORY_FETCH_FAILED';
      return { ok: false, failure: { code: code ?? 'DIRECTORY_FETCH_FAILED', message, stage: 'stage:directory', observedAt: new Date(), diagnostic: { sensitivity: 'privileged', finalUrl: this.url.href, bodyCaptured: false } }, ...(this.lastKnownGood && { snapshot: this.lastKnownGood }) };
    }
  }
}
