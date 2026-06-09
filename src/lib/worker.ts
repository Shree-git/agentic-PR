import { executeTool, checkReadiness, hydrateComposioLog, toolSlugFor } from "./composio";
import { getLedger } from "./ledger";
import { generateOpenRouterPatch } from "./openrouter";
import { validatePatchForPr, type PatchValidationIssue } from "./patch-validation";
import { findPatchPlan, type PatchPlan } from "./patch-catalog";
import type { ArtifactKind, ComposioLogEvidence, Incident, RunBundle, RunRecord, RunStepRecord, Toolkit, ToolExecutionInput, ToolResult } from "./types";

const activeRuns = new Set<string>();

export const SHEETS_AUDIT_HEADERS = [
  "Run ID",
  "Created At",
  "Updated At",
  "Source",
  "Severity",
  "Incident",
  "Fingerprint",
  "Culprit",
  "Outcome",
  "Patch Status",
  "Patch ID",
  "Suspected Cause",
  "Linear ID",
  "Linear URL",
  "GitHub PR Number",
  "GitHub PR URL",
  "Slack Channel",
  "Slack Message TS",
  "Evidence Console",
  "Composio Log IDs",
  "Tool Latency Ms",
  "Failures"
] as const;

export interface IntegrationRunDetails {
  runId: string;
  createdAt: string;
  updatedAt: string;
  source: Incident["source"];
  severity: Incident["severity"];
  incident: string;
  fingerprint: string;
  culprit: string;
  outcome: "pr_opened" | "investigation_only";
  patchStatus: "validated_patch" | "llm_generated_patch" | "rejected_patch" | "no_patch_match";
  patchId: string;
  suspectedCause: string;
  linearId: string;
  linearUrl: string;
  githubPrNumber: string;
  githubPrUrl: string;
  slackChannel: string;
  slackMessageTs: string;
  evidenceConsole: string;
  composioLogIds: string[];
  composioLogRefs: Array<{ id: string; apiPath: string }>;
  composioLogs: ComposioLogEvidence[];
  toolLatencyMs: number;
  failures: number;
  sentryIssueId?: string;
  sentryEventId?: string;
  project?: string;
  environment?: string;
  release?: string;
  tags?: Record<string, string>;
}

export async function enqueueIncident(incident: Incident): Promise<{ runId: string; created: boolean }> {
  const ledger = await getLedger();
  const { run, created } = ledger.createOrGetRun(incident);

  if (created || run.status === "queued" || run.status === "failed") {
    startWorker(run.id);
  }

  return { runId: run.id, created };
}

export function startWorker(runId: string): void {
  if (activeRuns.has(runId)) return;
  activeRuns.add(runId);
  setImmediate(() => {
    processRun(runId).finally(() => activeRuns.delete(runId));
  });
}

export async function processRun(runId: string): Promise<void> {
  const ledger = await getLedger();
  const readiness = await checkReadiness();
  if (!readiness.ready || (readiness.mode === "real" && !readiness.judgeReady)) {
    const blocker = readiness.preflight.find((item) => item.required && !item.ok);
    ledger.setRunStatus(runId, "needs_auth", "received", blocker?.reason ?? "Missing required Composio connected accounts");
    return;
  }

  const incident = ledger.getIncident(runId);
  ledger.setRunStatus(runId, "running", "received");
  ledger.startStep({
    runId,
    step: "received",
    toolkit: "local",
    toolSlug: "NORMALIZE_INCIDENT",
    idempotencyKey: `${runId}:received`
  });
  ledger.finishStep({
    runId,
    idempotencyKey: `${runId}:received`,
    status: "success",
    message: "Incident normalized and deduplicated",
    data: incident
  });

  if (incident.context?.triggerLogId) {
    ledger.startStep({
      runId,
      step: "sentry_trigger",
      toolkit: "sentry",
      toolSlug: incident.context.triggerName ?? "COMPOSIO_SENTRY_TRIGGER",
      idempotencyKey: `${runId}:sentry_trigger`
    });
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:sentry_trigger`,
      status: "success",
      composioLogId: incident.context.triggerLogId,
      message: "Composio Sentry trigger evidence captured",
      data: {
        triggerLogId: incident.context.triggerLogId,
        provider: incident.context.triggerProvider,
        name: incident.context.triggerName
      }
    });
  }

  const catalogPatch = findPatchPlan(incident);
  let candidatePatch: PatchPlan | null = null;
  ledger.startStep({
    runId,
    step: "patch_catalog",
    toolkit: "local",
    toolSlug: "PATCH_CATALOG_LOOKUP",
    idempotencyKey: `${runId}:patch_catalog`
  });

  if (catalogPatch) {
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:patch_catalog`,
      status: "success",
      message: `Matched patch catalog fallback entry: ${catalogPatch.id}`,
      data: catalogPatch
    });
  } else {
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:patch_catalog`,
      status: "skipped",
      message: "No patch catalog entry matched; OpenRouter will attempt a generated fix.",
      data: { incidentFingerprint: incident.fingerprint }
    });
  }

  candidatePatch = await generatePatchWithLedger(runId, incident, catalogPatch);
  if (!candidatePatch) candidatePatch = catalogPatch;

  const validation = await validatePatchWithLedger(runId, candidatePatch);
  const patch = validation.ok ? validation.patch : null;

  if (candidatePatch) {
    ledger.addArtifact({
      runId,
      kind: "patch",
      label: patch ? patch.title : `Rejected patch: ${candidatePatch.title}`,
      externalId: candidatePatch.id,
      externalUrl: `data:text/plain,${encodeURIComponent(candidatePatch.diff)}`
    });
  }

  try {
    const initialDetails = buildRunIntegrationDetails({
      run: ledger.getRun(runId),
      incident,
      patch,
      rejectedPatch: validation.ok ? null : candidatePatch,
      bundle: ledger.getBundle(runId)
    });
    const linear = await mustExecute({
      runId,
      step: "linear_issue",
      toolkit: "linear",
      toolSlug: toolSlugFor("linear_issue"),
      idempotencyKey: `${runId}:linear_issue`,
      arguments: {
        title: patch ? `[Agent PR] ${incident.title}` : `[Investigation] ${incident.title}`,
        description: linearDescription(initialDetails, incident, patch, validation.ok ? [] : validation.issues),
        team_id: process.env.DEMO_LINEAR_TEAM_ID ?? process.env.DEMO_LINEAR_TEAM ?? "ENG",
        priority: linearPriorityForSeverity(incident.severity),
        labels: ["incident", "agentic-autopilot", patch ? labelForPatch(patch) : "investigation-only"],
        ...(process.env.DEMO_LINEAR_PROJECT_ID ? { project_id: process.env.DEMO_LINEAR_PROJECT_ID } : {}),
        ...(process.env.DEMO_LINEAR_ASSIGNEE_ID ? { assignee_id: process.env.DEMO_LINEAR_ASSIGNEE_ID } : {}),
        ...(process.env.DEMO_LINEAR_STATE_ID ? { state_id: process.env.DEMO_LINEAR_STATE_ID } : {})
      }
    });
    await addArtifactFromTool(runId, "linear_issue", "Linear issue", linear);

    let github: ToolResult | null = null;
    if (patch) {
      const owner = process.env.DEMO_GITHUB_OWNER ?? "demo-org";
      const repo = process.env.DEMO_GITHUB_REPO ?? "incident-fixtures";
      const branch = `${patch.branchName}-${runId}`;
      await mustExecute({
        runId,
        step: "github_commit",
        toolkit: "github",
        toolSlug: toolSlugFor("github_commit"),
        idempotencyKey: `${runId}:github_commit`,
        arguments: {
          owner,
          repo,
          branch,
          base_branch: process.env.DEMO_GITHUB_BASE ?? "main",
          message: patch.title,
          upserts: [
            ...(patch.replacementContent
              ? [
                  {
                    path: patch.filePath,
                    content: patch.replacementContent
                  }
                ]
              : []),
            {
              path: `agentic-autopilot-runs/${runId}.md`,
              content: githubEvidenceFile(runId, incident, patch)
            }
          ]
        }
      });

      github = await mustExecute({
        runId,
        step: "github_pr",
        toolkit: "github",
        toolSlug: toolSlugFor("github_pr"),
        idempotencyKey: `${runId}:github_pr`,
        arguments: {
          owner,
          repo,
          head: branch,
          base: process.env.DEMO_GITHUB_BASE ?? "main",
          title: patch.title,
          body: githubPrBody(
            buildRunIntegrationDetails({
              run: ledger.getRun(runId),
              incident,
              patch,
              linear,
              bundle: ledger.getBundle(runId)
            }),
            incident,
            patch
          ),
          draft: true,
          maintainer_can_modify: true
        }
      });
      await addArtifactFromTool(runId, "github_pr", "GitHub PR", github);
    } else {
      ledger.startStep({
        runId,
        step: "github_pr",
        toolkit: "github",
        toolSlug: toolSlugFor("github_pr"),
        idempotencyKey: `${runId}:github_pr`
      });
      ledger.finishStep({
        runId,
        idempotencyKey: `${runId}:github_pr`,
        status: "skipped",
        message: "Skipped PR because OpenRouter did not produce a patch and no safe catalog fallback matched.",
        data: { incidentFingerprint: incident.fingerprint }
      });
    }

    const preSheetDetails = buildRunIntegrationDetails({
      run: ledger.getRun(runId),
      incident,
      patch,
      linear,
      github,
      bundle: ledger.getBundle(runId)
    });
    const sheet = await mustExecute({
      runId,
      step: "sheets_audit",
      toolkit: "googlesheets",
      toolSlug: toolSlugFor("sheets_audit"),
      idempotencyKey: `${runId}:sheets_audit`,
      arguments: {
        spreadsheetId: process.env.DEMO_SHEET_ID ?? "demo-sheet",
        sheetName: process.env.DEMO_SHEET_NAME ?? "Sheet1",
        headers: [...SHEETS_AUDIT_HEADERS],
        keyColumn: "Run ID",
        rows: [sheetAuditRow(preSheetDetails)]
      }
    });
    await addArtifactFromTool(runId, "sheet_row", "Google Sheets audit row", sheet);

    const preSlackDetails = buildRunIntegrationDetails({
      run: ledger.getRun(runId),
      incident,
      patch,
      linear,
      github,
      sheet,
      bundle: ledger.getBundle(runId)
    });
    const slackText = slackMessage(preSlackDetails);
    const slack = await mustExecute({
      runId,
      step: "slack_update",
      toolkit: "slack",
      toolSlug: toolSlugFor("slack_update"),
      idempotencyKey: `${runId}:slack_update`,
      arguments: {
        channel: process.env.DEMO_SLACK_CHANNEL ?? "incident-response",
        markdown_text: slackText,
        unfurl_links: false,
        unfurl_media: false
      }
    });
    await addArtifactFromTool(runId, "slack_message", "Slack update", slack);

    const logDetails = buildRunIntegrationDetails({
      run: ledger.getRun(runId),
      incident,
      patch,
      linear,
      github,
      slack,
      bundle: ledger.getBundle(runId)
    });
    ledger.startStep({
      runId,
      step: "composio_log_hydration",
      toolkit: "local",
      toolSlug: "COMPOSIO_LOG_RECONCILE",
      idempotencyKey: `${runId}:composio_log_hydration`
    });
    const hydratedLogs = await hydrateComposioLogs(runId);
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:composio_log_hydration`,
      status: hydratedLogs.some((log) => log.warning) ? "skipped" : "success",
      message: hydratedLogs.some((log) => log.warning)
        ? "Composio log IDs captured; some log details could not be hydrated."
        : "Composio log evidence hydrated and redacted.",
      data: {
        logIds: logDetails.composioLogIds,
        logRefs: logDetails.composioLogRefs,
        logs: hydratedLogs
      }
    });

    ledger.setRunStatus(runId, patch ? "complete" : "partial", "composio_log_hydration");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ledger.setRunStatus(runId, "failed", null, message);
  }
}

async function validatePatchWithLedger(runId: string, patch: PatchPlan | null) {
  const ledger = await getLedger();
  const started = Date.now();
  const result = validatePatchForPr(patch);
  ledger.startStep({
    runId,
    step: "patch_validation",
    toolkit: "local",
    toolSlug: "PATCH_PR_SAFETY_GATE",
    idempotencyKey: `${runId}:patch_validation`
  });
  ledger.finishStep({
    runId,
    idempotencyKey: `${runId}:patch_validation`,
    status: result.ok ? "success" : "skipped",
    latencyMs: Date.now() - started,
    message: result.ok ? "Patch passed PR safety validation." : patchValidationMessage(result.issues),
    data: result
  });
  return result;
}

async function hydrateComposioLogs(runId: string): Promise<ComposioLogEvidence[]> {
  const ledger = await getLedger();
  const bundle = ledger.getBundle(runId);
  const externalSteps = bundle.steps.filter((step) => step.composioLogId && step.toolkit !== "local");
  const logs: ComposioLogEvidence[] = [];

  for (const step of externalSteps) {
    const log = await hydrateComposioLog({
      logId: step.composioLogId!,
      toolkit: step.toolkit as Toolkit,
      toolSlug: step.toolSlug
    });
    logs.push(log);
    ledger.addArtifact({
      runId,
      kind: "composio_log",
      label: `${step.toolkit} execution log`,
      externalId: log.logId,
      externalUrl: log.apiPath
    });
  }

  return logs;
}

async function mustExecute(input: ToolExecutionInput): Promise<ToolResult> {
  const result = await executeTool(input);
  if (!result.ok) throw new Error(`${input.step} failed: ${result.errorCode} ${result.message}`);
  return result;
}

async function generatePatchWithLedger(runId: string, incident: Incident, catalogPatch: PatchPlan | null): Promise<PatchPlan | null> {
  const ledger = await getLedger();
  const started = Date.now();
  ledger.startStep({
    runId,
    step: "llm_patch",
    toolkit: "local",
    toolSlug: "OPENROUTER_PATCH_PLAN",
    idempotencyKey: `${runId}:llm_patch`
  });

  try {
    const result = await generateOpenRouterPatch({ runId, incident, catalogPatch });
    const status = result.patch ? "success" : "skipped";
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:llm_patch`,
      status,
      latencyMs: Date.now() - started,
      message: result.patch
        ? `Generated patch with ${result.model}`
        : result.skippedReason ?? "OpenRouter did not return a patch",
      data: {
        model: result.model,
        reasoningTokens: result.reasoningTokens,
        patch: result.patch,
        rawResponse: result.rawResponse,
        skippedReason: result.skippedReason
      }
    });
    return result.patch;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:llm_patch`,
      status: "failed",
      latencyMs: Date.now() - started,
      errorCode: "OPENROUTER_PATCH_FAILED",
      message,
      data: { fallbackPatchId: catalogPatch?.id ?? null }
    });
    return null;
  }
}

async function addArtifactFromTool(runId: string, kind: ArtifactKind, label: string, result: ToolResult): Promise<void> {
  if (!result.ok) return;
  const ledger = await getLedger();
  ledger.addArtifact({
    runId,
    kind,
    label,
    externalId: externalIdFromToolResult(result),
    externalUrl: externalUrlFromToolData(result.data, runId, kind)
  });
}

export function buildRunIntegrationDetails(input: {
  run?: RunRecord;
  incident: Incident;
  patch?: PatchPlan | null;
  rejectedPatch?: PatchPlan | null;
  linear?: ToolResult | null;
  github?: ToolResult | null;
  slack?: ToolResult | null;
  sheet?: ToolResult | null;
  bundle?: RunBundle;
}): IntegrationRunDetails {
  const patch = input.patch !== undefined ? input.patch : patchFromBundle(input.bundle);
  const rejectedPatch = input.rejectedPatch ?? rejectedPatchFromBundle(input.bundle);
  const linearData = dataFromToolOrBundle(input.linear, input.bundle, "linear_issue");
  const githubData = dataFromToolOrBundle(input.github, input.bundle, "github_pr");
  const slackData = dataFromToolOrBundle(input.slack, input.bundle, "slack_update");
  const bundleSteps = input.bundle?.steps ?? [];
  const composioLogIds = bundleSteps.flatMap((step) => (step.composioLogId ? [step.composioLogId] : []));
  const toolLatencyMs = bundleSteps.reduce((sum, step) => sum + (step.latencyMs ?? 0), 0);

  return {
    runId: input.run?.id ?? "",
    createdAt: input.run?.createdAt ?? "",
    updatedAt: input.run?.updatedAt ?? new Date().toISOString(),
    source: input.incident.source,
    severity: input.incident.severity,
    incident: input.incident.title,
    fingerprint: input.incident.fingerprint,
    culprit: input.incident.culprit ?? "unknown",
    outcome: patch ? "pr_opened" : "investigation_only",
    patchStatus: patch ? patchStatusForPatch(patch) : rejectedPatch ? "rejected_patch" : "no_patch_match",
    patchId: patch?.id ?? rejectedPatch?.id ?? "",
    suspectedCause: patch?.suspectedCause ?? rejectedPatch?.suspectedCause ?? "No generated or catalog patch is available. Investigation required.",
    linearId: externalIdFromData(linearData),
    linearUrl: linearData ? externalUrlFromToolData(linearData, input.run?.id ?? "", "linear_issue") : "",
    githubPrNumber: fieldAsString(githubData, "number"),
    githubPrUrl: githubData ? externalUrlFromToolData(githubData, input.run?.id ?? "", "github_pr") : "",
    slackChannel: slackChannelFromData(slackData),
    slackMessageTs: slackTsFromData(slackData),
    evidenceConsole: evidenceConsoleUrl(input.run?.id ?? ""),
    composioLogIds,
    composioLogRefs: composioLogIds.map((id) => ({ id, apiPath: `/api/v3.1/logs/tool_execution/${id}` })),
    composioLogs: composioLogsFromBundle(input.bundle),
    toolLatencyMs,
    failures: bundleSteps.filter((step) => step.status === "failed").length,
    sentryIssueId: input.incident.context?.issueId,
    sentryEventId: input.incident.context?.eventId,
    project: input.incident.context?.project,
    environment: input.incident.context?.environment,
    release: input.incident.context?.release,
    tags: input.incident.context?.tags
  };
}

export function sheetAuditRow(details: IntegrationRunDetails): Array<string | number> {
  return [
    details.runId,
    details.createdAt,
    details.updatedAt,
    details.source,
    details.severity,
    details.incident,
    details.fingerprint,
    details.culprit,
    details.outcome,
    details.patchStatus,
    details.patchId,
    details.suspectedCause,
    details.linearId,
    details.linearUrl,
    details.githubPrNumber,
    details.githubPrUrl,
    details.slackChannel,
    details.slackMessageTs,
    details.evidenceConsole,
    details.composioLogIds.join(", "),
    details.toolLatencyMs,
    details.failures
  ];
}

function linearDescription(details: IntegrationRunDetails, incident: Incident, patch: PatchPlan | null, validationIssues: PatchValidationIssue[] = []): string {
  const validationSection = validationIssues.length
    ? `\n## Patch validation\n${validationIssues.map((issue) => `- ${issue.code}: ${issue.message}`).join("\n")}\n`
    : "";

  return `# Incident PR Autopilot

## Incident
${incident.title}

Severity: ${incident.severity}
Source: ${incident.source}
Fingerprint: ${incident.fingerprint}
Culprit: ${incident.culprit ?? "unknown"}
Run ID: ${details.runId}
Evidence console: ${details.evidenceConsole}
Sentry issue: ${incident.context?.issueId ?? "unknown"}
Sentry event: ${incident.context?.eventId ?? "unknown"}
Environment: ${incident.context?.environment ?? "unknown"}
Release: ${incident.context?.release ?? "unknown"}

## Agent outcome
Outcome: ${details.outcome}
Patch status: ${details.patchStatus}
Patch ID: ${details.patchId || "none"}

## Suspected cause
${details.suspectedCause}
${validationSection}

## Artifact links
GitHub PR: ${details.githubPrUrl || "not opened yet"}
Slack update: ${details.slackChannel ? `#${details.slackChannel}` : "pending"}

## Evidence
${incident.stackTrace ?? incident.message}`;
}

export function githubPrBody(details: IntegrationRunDetails, incident: Incident, patch: PatchPlan): string {
  return `## Incident summary
${incident.title}

${incident.message}

## Suspected cause
${details.suspectedCause}

## Patch source
- Patch ID: ${patch.id}
- Source: ${patch.source}
- Model: ${patch.model ?? "n/a"}
- Reasoning tokens: ${patch.reasoningTokens ?? "n/a"}
- Confidence: ${patch.confidence}
- Target file: ${patch.filePath}
- Outcome: ${details.outcome}

## Validation notes
${validationNotesForPatch(patch)}

## Linked evidence
- Linear issue: ${details.linearUrl || details.linearId || "created before PR, URL unavailable"}
- Evidence console: ${details.evidenceConsole}
- Run ID: ${details.runId}
- Source: ${incident.source}
- Severity: ${incident.severity}
- Fingerprint: ${incident.fingerprint}
- Culprit: ${incident.culprit ?? "unknown"}
- Sentry issue: ${incident.context?.issueId ?? "unknown"}
- Sentry event: ${incident.context?.eventId ?? "unknown"}

## Guardrail
This PR remains a draft for human review. Generated fixes must be reviewed and validated before merge.
`;
}

export function slackMessage(details: IntegrationRunDetails): string {
  const prLine = details.githubPrUrl ? `GitHub PR: ${details.githubPrUrl}` : "GitHub PR: not opened";
  const linearLine = details.linearUrl ? `Linear issue: ${details.linearUrl}` : `Linear issue: ${details.linearId || "pending"}`;
  const nextAction =
    details.outcome === "pr_opened"
      ? "Next action: review the draft PR and validate the patch."
      : "Next action: investigate the Linear issue; no safe PR was opened.";

  return `Incident PR Autopilot run ${details.runId}
Outcome: ${details.outcome}
Severity: ${details.severity}
Incident: ${details.incident}
Suspected cause: ${details.suspectedCause}
${linearLine}
${prLine}
Sheets audit: ${details.patchStatus}
Evidence console: ${details.evidenceConsole}
${nextAction}`;
}

function linearPriorityForSeverity(severity: Incident["severity"]): number {
  if (severity === "critical") return 1;
  if (severity === "error") return 2;
  if (severity === "warning") return 3;
  return 4;
}

function labelForPatch(patch: PatchPlan): string {
  return patch.source === "openrouter" ? "llm-generated-patch" : "validated-patch";
}

function patchStatusForPatch(patch: PatchPlan): IntegrationRunDetails["patchStatus"] {
  return patch.source === "openrouter" ? "llm_generated_patch" : "validated_patch";
}

function patchValidationMessage(issues: PatchValidationIssue[]): string {
  if (!issues.length) return "Patch did not pass PR safety validation.";
  return `Patch rejected before GitHub write: ${issues.map((issue) => issue.code).join(", ")}`;
}

function validationNotesForPatch(patch: PatchPlan): string {
  if (patch.validationNotes?.length) {
    return patch.validationNotes.map((note) => `- ${note}`).join("\n");
  }
  return "- The patch came from a deterministic catalog fallback.\n- Review and run the target repository tests before merge.";
}

function externalIdFromToolResult(result: Extract<ToolResult, { ok: true }>): string {
  return String(result.data.id ?? result.data.number ?? result.data.ts ?? result.logId);
}

function externalUrlFromToolData(data: Record<string, unknown>, runId: string, kind: ArtifactKind): string {
  const nestedLinks = data._links as { html?: { href?: string } } | undefined;
  const message = data.message as { team?: string; ts?: string } | undefined;
  const channel = typeof data.channel === "string" ? data.channel : undefined;
  const ts = typeof data.ts === "string" ? data.ts : message?.ts;
  const team = message?.team;

  if (typeof data.ticket_url === "string") return data.ticket_url;
  if (typeof data.html_url === "string") return data.html_url;
  if (nestedLinks?.html?.href) return nestedLinks.html.href;
  if (typeof data.displayUrl === "string") return data.displayUrl;
  if (typeof data.spreadsheetUrl === "string") return data.spreadsheetUrl;
  if (team && channel && ts) return `https://app.slack.com/client/${team}/${channel}/p${ts.replace(".", "")}`;
  if (typeof data.url === "string") return data.url;
  return `https://example.com/mock/${runId}/${kind}`;
}

function githubEvidenceFile(runId: string, incident: Incident, patch: PatchPlan): string {
  return `# Incident PR Autopilot Evidence

Run ID: ${runId}
Incident: ${incident.title}
Fingerprint: ${incident.fingerprint}
Severity: ${incident.severity}
Source: ${incident.source}
Sentry issue: ${incident.context?.issueId ?? "unknown"}
Sentry event: ${incident.context?.eventId ?? "unknown"}
Environment: ${incident.context?.environment ?? "unknown"}
Release: ${incident.context?.release ?? "unknown"}

## Suspected Cause
${patch.suspectedCause}

## Target File
${patch.filePath}

## Patch Source
Source: ${patch.source}
Model: ${patch.model ?? "n/a"}
Reasoning tokens: ${patch.reasoningTokens ?? "n/a"}
Confidence: ${patch.confidence}

## Diff
\`\`\`diff
${patch.diff}
\`\`\`

## Validation Notes
${validationNotesForPatch(patch)}
`;
}

function patchFromBundle(bundle?: RunBundle): PatchPlan | null {
  const llmStep = bundle?.steps.find((item) => item.step === "llm_patch" && item.status === "success");
  const llmPatch =
    llmStep?.data && typeof llmStep.data === "object" ? (llmStep.data as { patch?: Partial<PatchPlan> }).patch : null;
  const validationStep = bundle?.steps.find((item) => item.step === "patch_validation" && item.status === "success");
  if (!validationStep) return null;
  const catalogStep = bundle?.steps.find((item) => item.step === "patch_catalog" && item.status === "success");
  const patch = llmPatch ?? (catalogStep?.data && typeof catalogStep.data === "object" ? (catalogStep.data as Partial<PatchPlan>) : null);
  if (!patch) return null;
  if (!patch.id || !patch.suspectedCause) return null;
  return patch as PatchPlan;
}

function rejectedPatchFromBundle(bundle?: RunBundle): PatchPlan | null {
  const validationStep = bundle?.steps.find((item) => item.step === "patch_validation" && item.status === "skipped");
  if (!validationStep?.data || typeof validationStep.data !== "object") return null;
  const patch = (validationStep.data as { patch?: Partial<PatchPlan> }).patch;
  if (!patch?.id || !patch.suspectedCause) return null;
  return patch as PatchPlan;
}

function composioLogsFromBundle(bundle?: RunBundle): ComposioLogEvidence[] {
  const hydrationStep = bundle?.steps.find((item) => item.step === "composio_log_hydration");
  if (!hydrationStep?.data || typeof hydrationStep.data !== "object") return [];
  const logs = (hydrationStep.data as { logs?: unknown }).logs;
  return Array.isArray(logs) ? (logs as ComposioLogEvidence[]) : [];
}

function dataFromToolOrBundle(result: ToolResult | null | undefined, bundle: RunBundle | undefined, stepName: RunStepRecord["step"]): Record<string, unknown> | null {
  if (result?.ok) return result.data;
  const step = bundle?.steps.find((item) => item.step === stepName && item.status === "success");
  return step?.data && typeof step.data === "object" ? (step.data as Record<string, unknown>) : null;
}

function externalIdFromData(data: Record<string, unknown> | null): string {
  if (!data) return "";
  return String(data.id ?? data.number ?? data.ts ?? "");
}

function fieldAsString(data: Record<string, unknown> | null, field: string): string {
  const value = data?.[field];
  return value == null ? "" : String(value);
}

function slackChannelFromData(data: Record<string, unknown> | null): string {
  const message = data?.message as { channel?: string } | undefined;
  return String(data?.channel ?? message?.channel ?? process.env.DEMO_SLACK_CHANNEL ?? "incident-response");
}

function slackTsFromData(data: Record<string, unknown> | null): string {
  const message = data?.message as { ts?: string } | undefined;
  return String(data?.ts ?? message?.ts ?? "");
}

function evidenceConsoleUrl(runId: string): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? process.env.DEMO_BASE_URL;
  const path = `/runs/${runId}`;
  return baseUrl ? `${baseUrl.replace(/\/$/, "")}${path}` : path;
}
