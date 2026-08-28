import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Mutex } from 'async-mutex';
import type { DependencyEdge } from './dependencies';

export class JsonDependencyStore {
  private readonly mutex = new Mutex();
  public constructor(private readonly path: string) {}

  public async load(): Promise<DependencyEdge[]> {
    try {
      const edges = JSON.parse(await readFile(this.path, 'utf8')) as DependencyEdge[];
      return edges.map(edge => ({ ...edge, observedAt: new Date(edge.observedAt) }));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  public async save(edges: readonly DependencyEdge[]): Promise<void> {
    await this.mutex.runExclusive(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temporaryPath = `${this.path}.tmp`;
      await writeFile(temporaryPath, JSON.stringify(edges));
      await rename(temporaryPath, this.path);
    });
  }
}
