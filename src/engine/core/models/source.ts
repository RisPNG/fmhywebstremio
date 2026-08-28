import type { FailureCode } from './failures';

export type FamilyEvidence
  = | { type: 'asset-path'; value: string }
    | { type: 'dom-shape'; fingerprint: string }
    | { type: 'route-shape'; value: string }
    | { type: 'generator-meta'; value: string }
    | { type: 'api-shape'; fingerprint: string }
    | { type: 'script-signature'; fingerprint: string };

export type SourceStatus = 'unknown' | 'supported' | 'degraded' | 'unsupported' | 'disabled';
export type SourceProbeOutcome = 'matched' | 'redirected' | 'unsupported' | 'unreachable' | 'blocked' | 'ambiguous' | 'budget-exceeded';

export interface SourceProbeState {
  outcome: SourceProbeOutcome;
  observedAt: Date;
  finalUrl?: string;
  failureCode?: FailureCode;
  message?: string;
}

export interface SourceRecord {
  id: string;
  canonicalDomain: string;
  aliases: string[];
  fmhy: {
    section?: string;
    tags?: string[];
    firstSeenAt: Date;
    lastSeenAt: Date;
  };
  family?: {
    id: string;
    confidence: number;
    evidence: FamilyEvidence[];
    lastProbedAt: Date;
  };
  probe?: SourceProbeState;
  status: SourceStatus;
}

export interface SourceHealthHistory {
  sourceId: string;
  lastOutcome?: 'healthy' | 'degraded' | 'failed';
  recentSuccesses: number;
  recentFailures: number;
  recentLatencyMs?: number;
  observedAt?: Date;
}
