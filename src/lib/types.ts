export const REQUIRED_TOOLKITS = ["sentry", "linear", "github", "slack", "googlesheets"] as const;

export type Toolkit = (typeof REQUIRED_TOOLKITS)[number];

export type IncidentSource = "sentry" | "slack";

export type RunStatus = "queued" | "running" | "complete" | "failed" | "partial" | "needs_auth";

export type StepStatus = "pending" | "running" | "success" | "failed" | "skipped";

export type StepName =
  | "received"
  | "sentry_trigger"
  | "linear_issue"
  | "patch_validation"
  | "patch_catalog"
  | "llm_patch"
  | "github_commit"
  | "github_pr"
  | "slack_update"
  | "sheets_audit"
  | "composio_log_hydration";

export type ArtifactKind = "linear_issue" | "github_pr" | "slack_message" | "sheet_row" | "patch" | "composio_log";

export interface Incident {
  source: IncidentSource;
  fingerprint: string;
  title: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  culprit?: string;
  stackTrace?: string;
  context?: {
    issueId?: string;
    eventId?: string;
    project?: string;
    environment?: string;
    release?: string;
    url?: string;
    triggerLogId?: string;
    triggerProvider?: string;
    triggerName?: string;
    tags?: Record<string, string>;
  };
  raw: unknown;
}

export interface ComposioLogEvidence {
  logId: string;
  toolkit: Toolkit;
  toolSlug: string;
  status: "success" | "failed" | "error" | "warning" | "info" | "unknown";
  durationMs: number | null;
  requestSummary: Record<string, unknown>;
  responseSummary: Record<string, unknown>;
  apiPath: string;
  warning?: string;
}

export interface RunRecord {
  id: string;
  incidentFingerprint: string;
  source: IncidentSource;
  title: string;
  summary: string;
  status: RunStatus;
  currentStep: StepName | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RunStepRecord {
  id: string;
  runId: string;
  step: StepName;
  status: StepStatus;
  idempotencyKey: string;
  toolkit: Toolkit | "local";
  toolSlug: string;
  composioLogId: string | null;
  attempts: number;
  latencyMs: number | null;
  errorCode: string | null;
  message: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  data: unknown;
}

export interface ArtifactRecord {
  id: string;
  runId: string;
  kind: ArtifactKind;
  label: string;
  externalId: string;
  externalUrl: string;
  createdAt: string;
}

export interface RunBundle {
  run: RunRecord;
  steps: RunStepRecord[];
  artifacts: ArtifactRecord[];
}

export interface ToolExecutionInput {
  runId: string;
  step: StepName;
  toolkit: Toolkit;
  toolSlug: string;
  arguments: Record<string, unknown>;
  idempotencyKey: string;
}

export interface ToolExecutionResult {
  ok: true;
  data: Record<string, unknown>;
  logId: string;
  latencyMs: number;
}

export interface ToolExecutionFailure {
  ok: false;
  errorCode: string;
  message: string;
  retryable: boolean;
  latencyMs: number;
}

export type ToolResult = ToolExecutionResult | ToolExecutionFailure;

export interface ReadinessCheck {
  mode: "mock" | "real";
  ready: boolean;
  judgeReady: boolean;
  userId: string;
  toolkits: Array<{
    toolkit: Toolkit;
    connected: boolean;
    reason?: string;
    connectUrl?: string;
  }>;
  preflight: Array<{
    key: string;
    label: string;
    ok: boolean;
    required: boolean;
    reason?: string;
  }>;
}
