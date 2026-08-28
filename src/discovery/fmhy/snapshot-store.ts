import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DirectorySnapshot, DirectorySnapshotStore } from './models';

export class JsonDirectorySnapshotStore implements DirectorySnapshotStore {
  public constructor(private readonly path: string) {}

  public async load(): Promise<DirectorySnapshot | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as { fetchedAt: string; upstreamVersion?: string; entries: { name: string; urls: string[]; section: string; tags: string[]; mirrors: string[]; apiHint: boolean }[] };
      return { fetchedAt: new Date(value.fetchedAt), ...(value.upstreamVersion && { upstreamVersion: value.upstreamVersion }), entries: value.entries.map(entry => ({ ...entry, urls: entry.urls.map(url => new URL(url)), mirrors: entry.mirrors.map(url => new URL(url)) })) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async save(snapshot: DirectorySnapshot): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(snapshot));
    await rename(temporaryPath, this.path);
  }
}
