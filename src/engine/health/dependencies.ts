import type { Failure } from '../core/models';

export interface DependencyEdge { sourceId: string; familyId: string; provider: string; observedAt: Date }
export class DependencyGraph {
  private readonly edges = new Map<string, DependencyEdge>();
  public record(edge: DependencyEdge): void { this.edges.set(`${edge.sourceId}:${edge.familyId}:${edge.provider}`, edge); }
  public list(): DependencyEdge[] { return [...this.edges.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.sourceId.localeCompare(b.sourceId)); }

  public restore(edges: readonly DependencyEdge[]): void {
    this.edges.clear();
    for (const edge of edges) this.record(edge);
  }

  public rollup(failures: readonly Failure[]): Readonly<Record<string, readonly string[]>> {
    const groups = new Map<string, Set<string>>();
    for (const failure of failures) {
      const node = failure.targetHost ?? failure.extractorId ?? failure.familyId ?? failure.sourceId ?? 'unknown';
      const key = `${failure.code}:${node}`;
      const affected = groups.get(key) ?? new Set<string>();
      for (const edge of this.edges.values()) if (edge.provider === node || edge.familyId === node || edge.sourceId === node) affected.add(edge.sourceId);
      if (failure.sourceId) affected.add(failure.sourceId);
      groups.set(key, affected);
    }
    return Object.fromEntries([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, values]) => [key, [...values].sort()]));
  }

  public report(failures: readonly Failure[]): string { return Object.entries(this.rollup(failures)).map(([root, sources]) => `${root}\n${sources.map(source => `  ${source}`).join('\n')}`).join('\n\n'); }
}
