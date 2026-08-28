import type { Failure, MediaIdentity } from '../core/models';

export type ProbeExpectation = 'discoverable' | 'absent';
export interface FamilyProbeCase { id: string; media: MediaIdentity; expected: ProbeExpectation; notes?: string }
export interface FamilyHealthCorpus { familyId: string; cases: readonly FamilyProbeCase[] }
export interface ProbeCaseOutcome { caseId: string; expected: ProbeExpectation; discovered: boolean; stages: { discovery: boolean; extraction?: boolean; validation?: boolean }; failure?: Failure }
export interface FamilyHealthOutcome { status: 'healthy' | 'degraded'; extractable: boolean; staleCases: readonly string[]; anomalies: readonly string[]; stages: { discovery: boolean; extraction: boolean; validation: boolean }; cases: readonly ProbeCaseOutcome[] }

export function evaluateFamilyHealth(corpus: FamilyHealthCorpus, outcomes: readonly ProbeCaseOutcome[], quorum = 0.5): FamilyHealthOutcome {
  const positives = corpus.cases.filter(test => test.expected === 'discoverable');
  const failed = positives.filter(test => !outcomes.find(outcome => outcome.caseId === test.id)?.stages.validation);
  const staleCases = failed.length > 0 && failed.length / Math.max(positives.length, 1) < quorum ? failed.map(test => test.id).sort() : [];
  const anomalies = corpus.cases.filter(test => test.expected === 'absent' && outcomes.find(outcome => outcome.caseId === test.id)?.discovered).map(test => test.id).sort();
  const positiveOutcomes = outcomes.filter(outcome => positives.some(test => test.id === outcome.caseId));
  const stages = { discovery: positiveOutcomes.some(value => value.stages.discovery), extraction: positiveOutcomes.some(value => value.stages.extraction), validation: positiveOutcomes.some(value => value.stages.validation) };
  return { status: failed.length / Math.max(positives.length, 1) >= quorum ? 'degraded' : 'healthy', extractable: stages.validation, staleCases, anomalies, stages, cases: outcomes };
}
