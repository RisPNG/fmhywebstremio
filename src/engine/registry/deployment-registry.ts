import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { SourceHealthHistory } from '../core/models';
import { SourceRegistry } from './source-registry';

export const keptSourceIds: ReadonlySet<string> = new Set(['atlantic:atlantic.bz', 'bilibili:bilibili.com', 'cinefork:cinefork.net', 'cineruv:cineruv.website', 'kkphim:kkphim.com', 'milkbox:milkbox.fyi', 'sweetfox:111flix.net']);

function serializeRegistryValue(value: unknown, indentation = 0): string {
  if (value instanceof Date) return 'new Date(0)';
  if (typeof value === 'string') return `'${value.replaceAll('\\', '\\\\').replaceAll('\'', '\\\'').replaceAll('\n', '\\n').replaceAll('\r', '\\r')}'`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    const padding = '  '.repeat(indentation);
    return `[\n${value.map(item => `${padding}  ${serializeRegistryValue(item, indentation + 1)},`).join('\n')}\n${padding}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
  if (!entries.length) return '{}';
  const padding = '  '.repeat(indentation);
  return `{\n${entries.map(([key, item]) => `${padding}  ${key}: ${serializeRegistryValue(item, indentation + 1)},`).join('\n')}\n${padding}}`;
}

export async function writeDeploymentSourceRegistry(registry: SourceRegistry, path: string, kept: ReadonlySet<string>): Promise<void> {
  const records = registry.runtimeEligible().filter(source => kept.has(source.id)).map(record => ({
    ...record,
    fmhy: { ...record.fmhy, firstSeenAt: new Date(0), lastSeenAt: new Date(0) },
    ...(record.family && { family: { ...record.family, lastProbedAt: new Date(0) } }),
    ...(record.probe && { probe: { ...record.probe, observedAt: new Date(0) } }),
  }));
  const health = records.map(record => ({ ...(registry.health().get(record.id) as SourceHealthHistory), observedAt: new Date(0) }));
  const source = `import type { SourceRegistryState } from './source-registry';\n\nexport const deploymentSourceRegistry: SourceRegistryState = {\n  records: ${serializeRegistryValue(records, 1)},\n  health: ${serializeRegistryValue(health, 1)},\n};\n`;

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, source);
}
