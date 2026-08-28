export type FamilyEvidence =
  | { type: "asset-path"; value: string }
  | { type: "dom-shape"; fingerprint: string }
  | { type: "route-shape"; value: string }
  | { type: "generator-meta"; value: string }
  | { type: "api-shape"; fingerprint: string }
  | { type: "script-signature"; fingerprint: string };

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
  status: "unknown" | "supported" | "degraded" | "unsupported" | "disabled";
}
