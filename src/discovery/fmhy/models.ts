import type { Failure } from '../../engine/core/models';

export interface FmhyDirectoryEntry { name: string; urls: URL[]; section: string; tags: string[]; mirrors: URL[]; apiHint: boolean }
export interface DirectorySnapshot { fetchedAt: Date; upstreamVersion?: string; entries: FmhyDirectoryEntry[] }
export type DirectoryDiffType = 'SOURCE_ADDED' | 'SOURCE_REMOVED' | 'DOMAIN_ADDED' | 'DOMAIN_REMOVED' | 'METADATA_CHANGED' | 'UNCHANGED';
export interface DirectoryDiff { type: DirectoryDiffType; source: string; domain?: string }
export type DirectoryUpdate = { ok: true; snapshot: DirectorySnapshot; diff: readonly DirectoryDiff[] } | { ok: false; failure: Failure; snapshot?: DirectorySnapshot };
export interface DirectorySnapshotStore {
  load(): Promise<DirectorySnapshot | undefined>;
  save(snapshot: DirectorySnapshot): Promise<void>;
}
