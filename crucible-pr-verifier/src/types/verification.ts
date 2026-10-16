export type SpecialistDomain = 'security' | 'edge_cases' | 'state' | 'regression';

export interface PullRequestTarget {
  id: string;
  repo: string;
  prNumber: number;
  title: string;
  author: string;
  aiGenerator: string;
  branch: string;
  baseBranch: string;
  commitSha: string;
  timestamp: string;
  description: string;
  filePath: string;
  language: 'python';
  code: string;
  diff: string;
}

export interface CodeInvariant {
  id: string;
  title: string;
  category: SpecialistDomain;
  formalProperty: string;
  targetSymbol: string;
  rationale: string;
  plannedAttackVector: string;
}

export interface BreakingTestCase {
  id: string;
  agent: SpecialistDomain;
  invariantId: string;
  name: string;
  hypothesis: string;
  pythonTestCode: string;
  run1Status: 'FAIL' | 'PASS' | 'FLAKY_ERROR';
  run2Status: 'FAIL' | 'PASS' | 'FLAKY_ERROR';
  reproducedTwice: boolean;
  failureOutput: string;
  severity: 'Critical' | 'High' | 'Medium';
  violatedLineRange: string;
  remediationHint: string;
}

export interface PlantedBugMutant {
  id: string;
  name: string;
  category: SpecialistDomain;
  description: string;
  mutatedSnippet: string;
  originalSnippet: string;
  caught: boolean;
  caughtByTestId: string | null;
  caughtByAgent: SpecialistDomain | null;
  blindSpotAnalysis: string;
}

export interface SandboxStepLog {
  index: number;
  type: 'thought' | 'code_execution_call' | 'code_execution_result' | 'model_output';
  timestamp: string;
  summary: string;
  detail?: string;
}

export interface ResidualRiskItem {
  id: string;
  title: string;
  source: string;
  impact: string;
  recommendation: string;
}

export interface VerificationReport {
  runId: string;
  prId: string;
  verifiedAt: string;
  plannerModel: string;
  attackerModel: string;
  sandboxAgent: string;
  environmentId: string;
  interactionId: string;
  invariants: CodeInvariant[];
  tests: BreakingTestCase[];
  reproducibleFailures: BreakingTestCase[];
  quarantinedFlakes: BreakingTestCase[];
  plantedBugs: PlantedBugMutant[];
  plantedBugsCaught: number;
  plantedBugsTotal: number;
  detectionScorePct: number;
  residualRisks: ResidualRiskItem[];
  executiveSummary: string;
  recommendedAction: 'REJECT_MERGE' | 'APPROVE_WITH_CAUTION' | 'APPROVE_MERGE';
  sandboxSteps: SandboxStepLog[];
}

export interface MergeDecisionRecord {
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reviewer: string;
  decidedAt?: string;
  note: string;
}
