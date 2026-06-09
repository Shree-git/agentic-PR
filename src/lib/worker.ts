import { executeTool, checkReadiness, toolSlugFor } from "./composio";
import { getLedger } from "./ledger";
import { findPatchPlan } from "./patch-catalog";
import type { ArtifactKind, Incident, ToolExecutionInput, ToolResult } from "./types";

const activeRuns = new Set<string>();

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
  if (!readiness.ready) {
    ledger.setRunStatus(runId, "needs_auth", "received", "Missing required Composio connected accounts");
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

  const patch = findPatchPlan(incident);
  ledger.startStep({
    runId,
    step: "patch_catalog",
    toolkit: "local",
    toolSlug: "PATCH_CATALOG_LOOKUP",
    idempotencyKey: `${runId}:patch_catalog`
  });

  if (patch) {
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:patch_catalog`,
      status: "success",
      message: `Matched patch catalog entry: ${patch.id}`,
      data: patch
    });
    ledger.addArtifact({
      runId,
      kind: "patch",
      label: patch.title,
      externalId: patch.id,
      externalUrl: `data:text/plain,${encodeURIComponent(patch.diff)}`
    });
  } else {
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:patch_catalog`,
      status: "skipped",
      message: "No safe patch catalog entry matched; PR creation will be skipped.",
      data: { incidentFingerprint: incident.fingerprint }
    });
  }

  try {
    const linear = await mustExecute({
      runId,
      step: "linear_issue",
      toolkit: "linear",
      toolSlug: toolSlugFor("linear_issue"),
      idempotencyKey: `${runId}:linear_issue`,
      arguments: {
        title: patch ? `[Agent PR] ${incident.title}` : `[Investigation] ${incident.title}`,
        description: linearDescription(incident, patch?.suspectedCause),
        team: process.env.DEMO_LINEAR_TEAM ?? "ENG"
      }
    });
    await addArtifactFromTool(runId, "linear_issue", "Linear issue", linear);

    let github: ToolResult | null = null;
    if (patch) {
      github = await mustExecute({
        runId,
        step: "github_pr",
        toolkit: "github",
        toolSlug: toolSlugFor("github_pr"),
        idempotencyKey: `${runId}:github_pr`,
        arguments: {
          owner: process.env.DEMO_GITHUB_OWNER ?? "demo-org",
          repo: process.env.DEMO_GITHUB_REPO ?? "incident-fixtures",
          head: `${patch.branchName}-${runId}`,
          base: "main",
          title: patch.title,
          body: `${patch.prBody}\n\nRun ID: ${runId}`,
          changes: [{ path: patch.filePath, before: patch.beforeSnippet, after: patch.afterSnippet, diff: patch.diff }]
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
        message: "Skipped PR because no safe patch catalog match existed.",
        data: { incidentFingerprint: incident.fingerprint }
      });
    }

    const sheet = await mustExecute({
      runId,
      step: "sheets_audit",
      toolkit: "googlesheets",
      toolSlug: toolSlugFor("sheets_audit"),
      idempotencyKey: `${runId}:sheets_audit`,
      arguments: {
        spreadsheetId: process.env.DEMO_SHEET_ID ?? "demo-sheet",
        values: [[runId, incident.title, patch ? "pr_opened" : "investigation_only", new Date().toISOString()]]
      }
    });
    await addArtifactFromTool(runId, "sheet_row", "Google Sheets audit row", sheet);

    const slack = await mustExecute({
      runId,
      step: "slack_update",
      toolkit: "slack",
      toolSlug: toolSlugFor("slack_update"),
      idempotencyKey: `${runId}:slack_update`,
      arguments: {
        channel: process.env.DEMO_SLACK_CHANNEL ?? "incident-response",
        text: slackMessage(runId, incident, Boolean(patch), github)
      }
    });
    await addArtifactFromTool(runId, "slack_message", "Slack update", slack);

    ledger.startStep({
      runId,
      step: "composio_log_hydration",
      toolkit: "local",
      toolSlug: "COMPOSIO_LOG_RECONCILE",
      idempotencyKey: `${runId}:composio_log_hydration`
    });
    ledger.finishStep({
      runId,
      idempotencyKey: `${runId}:composio_log_hydration`,
      status: "success",
      message: "Composio log IDs captured from tool execution responses; API hydration can run after demo export.",
      data: ledger.getBundle(runId).steps.map((step) => ({ step: step.step, logId: step.composioLogId }))
    });

    ledger.setRunStatus(runId, patch ? "complete" : "partial", "composio_log_hydration");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ledger.setRunStatus(runId, "failed", null, message);
  }
}

async function mustExecute(input: ToolExecutionInput): Promise<ToolResult> {
  const result = await executeTool(input);
  if (!result.ok) throw new Error(`${input.step} failed: ${result.errorCode} ${result.message}`);
  return result;
}

async function addArtifactFromTool(runId: string, kind: ArtifactKind, label: string, result: ToolResult): Promise<void> {
  if (!result.ok) return;
  const ledger = await getLedger();
  ledger.addArtifact({
    runId,
    kind,
    label,
    externalId: String(result.data.id ?? result.logId),
    externalUrl: String(result.data.url ?? `https://example.com/mock/${runId}/${kind}`)
  });
}

function linearDescription(incident: Incident, suspectedCause?: string): string {
  return `Incident: ${incident.title}

Severity: ${incident.severity}
Fingerprint: ${incident.fingerprint}
Culprit: ${incident.culprit ?? "unknown"}

Suspected cause:
${suspectedCause ?? "No validated patch is available. Investigation required."}

Evidence:
${incident.stackTrace ?? incident.message}`;
}

function slackMessage(runId: string, incident: Incident, openedPr: boolean, github: ToolResult | null): string {
  const prUrl = github?.ok ? String(github.data.url ?? "PR URL unavailable") : "not opened";
  return `Incident PR Autopilot run ${runId}
Incident: ${incident.title}
Suspected cause: ${openedPr ? "Matched validated patch catalog entry." : "No safe patch match; investigation issue created."}
GitHub PR: ${prUrl}
Evidence console: /runs/${runId}`;
}
