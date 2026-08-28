import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SourceRegistryState } from './source-registry';

export class JsonSourceRegistryStore {
  public constructor(private readonly path: string) {}

  public async load(): Promise<SourceRegistryState | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as SourceRegistryState;
      return {
        records: value.records.map(record => ({ ...record, fmhy: { ...record.fmhy, firstSeenAt: new Date(record.fmhy.firstSeenAt), lastSeenAt: new Date(record.fmhy.lastSeenAt) }, ...(record.family && { family: { ...record.family, lastProbedAt: new Date(record.family.lastProbedAt) } }), ...(record.probe && { probe: { ...record.probe, observedAt: new Date(record.probe.observedAt) } }) })),
        health: value.health.map(outcome => ({ ...outcome, ...(outcome.observedAt && { observedAt: new Date(outcome.observedAt) }) })),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }

  public async save(state: SourceRegistryState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(state));
    await rename(temporaryPath, this.path);
  }
}
