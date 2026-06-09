"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  ExternalLink,
  FileCode2,
  GitPullRequestArrow,
  Link2,
  Loader2,
  MessageSquare,
  Table2,
  TicketCheck
} from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ArtifactKind, ComposioLogEvidence, RunBundle, StepStatus } from "@/lib/types";

const artifactIcons: Record<ArtifactKind, ComponentType<{ size?: number; "aria-hidden"?: boolean }>> = {
  linear_issue: TicketCheck,
  github_pr: GitPullRequestArrow,
  slack_message: MessageSquare,
  sheet_row: Table2,
  patch: FileCode2,
  composio_log: Link2
};

function terminalStatus(status: RunBundle["run"]["status"]) {
  return ["complete", "failed", "partial", "needs_auth"].includes(status);
}

function formatStepName(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function statusIcon(status: StepStatus) {
  if (status === "success") return CheckCircle2;
  if (status === "failed") return AlertTriangle;
  if (status === "running") return Loader2;
  return Clock3;
}

function decodePatch(url: string) {
  if (!url.startsWith("data:text/plain,")) return null;
  try {
    return decodeURIComponent(url.replace("data:text/plain,", ""));
  } catch {
    return null;
  }
}

function stepDataForArtifact(bundle: RunBundle, kind: ArtifactKind): Record<string, unknown> | null {
  const stepByKind: Partial<Record<ArtifactKind, string>> = {
    linear_issue: "linear_issue",
    github_pr: "github_pr",
    slack_message: "slack_update",
    sheet_row: "sheets_audit",
    patch: "patch_catalog"
  };
  const stepName = stepByKind[kind];
  const step = bundle.steps.find((item) => item.step === stepName && item.status === "success");
  return step?.data && typeof step.data === "object" ? (step.data as Record<string, unknown>) : null;
}

function nestedRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function valueLabel(value: unknown, fallback = "pending") {
  return value == null || value === "" ? fallback : String(value);
}

function artifactDetailRows(artifact: RunBundle["artifacts"][number], bundle: RunBundle): Array<{ label: string; value: string }> {
  const data = stepDataForArtifact(bundle, artifact.kind);
  const message = nestedRecord(data?.message);

  if (artifact.kind === "github_pr") {
    return [
      { label: "PR", value: data?.number ? `#${data.number}` : artifact.externalId },
      { label: "Title", value: valueLabel(data?.title, artifact.label) }
    ];
  }

  if (artifact.kind === "slack_message") {
    return [
      { label: "Channel", value: valueLabel(data?.channel ?? message?.channel) },
      { label: "TS", value: valueLabel(data?.ts ?? message?.ts, artifact.externalId) }
    ];
  }

  if (artifact.kind === "sheet_row") {
    return [
      { label: "Row", value: valueLabel(data?.row ?? data?.updatedRange, artifact.externalId) },
      { label: "Sheet", value: valueLabel(data?.sheetName ?? data?.spreadsheetId, "audit ledger") }
    ];
  }

  if (artifact.kind === "linear_issue") {
    return [
      { label: "Issue", value: artifact.externalId },
      { label: "Title", value: valueLabel(data?.title, artifact.label) }
    ];
  }

  if (artifact.kind === "patch") {
    return [
      { label: "Patch", value: artifact.externalId },
      { label: "File", value: valueLabel(data?.filePath) }
    ];
  }

  return [{ label: "ID", value: artifact.externalId }];
}

function hydrationLogs(bundle: RunBundle): ComposioLogEvidence[] {
  const step = bundle.steps.find((item) => item.step === "composio_log_hydration");
  if (!step?.data || typeof step.data !== "object") return [];
  const logs = (step.data as { logs?: unknown }).logs;
  return Array.isArray(logs) ? (logs as ComposioLogEvidence[]) : [];
}

function validationIssues(bundle: RunBundle): Array<{ code: string; message: string }> {
  const step = bundle.steps.find((item) => item.step === "patch_validation");
  if (!step?.data || typeof step.data !== "object") return [];
  const issues = (step.data as { issues?: unknown }).issues;
  return Array.isArray(issues) ? (issues as Array<{ code: string; message: string }>) : [];
}

function patchDetails(bundle: RunBundle): Record<string, unknown> | null {
  const validation = bundle.steps.find((item) => item.step === "patch_validation");
  if (validation?.data && typeof validation.data === "object") {
    const patch = (validation.data as { patch?: unknown }).patch;
    if (patch && typeof patch === "object") return patch as Record<string, unknown>;
  }
  return stepDataForArtifact(bundle, "patch");
}

export function RunConsole({ initialBundle }: { initialBundle: RunBundle }) {
  const [bundle, setBundle] = useState(initialBundle);
  const auditTableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (terminalStatus(bundle.run.status)) return;
    const id = setInterval(async () => {
      const response = await fetch(`/api/runs/${bundle.run.id}`, { cache: "no-store" });
      if (response.ok) setBundle(await response.json());
    }, 1200);
    return () => clearInterval(id);
  }, [bundle.run.id, bundle.run.status]);

  const patchPreview = useMemo(() => {
    const patch = bundle.artifacts.find((artifact) => artifact.kind === "patch");
    return patch ? decodePatch(patch.externalUrl) : null;
  }, [bundle.artifacts]);
  const logs = useMemo(() => hydrationLogs(bundle), [bundle]);
  const patch = useMemo(() => patchDetails(bundle), [bundle]);
  const patchIssues = useMemo(() => validationIssues(bundle), [bundle]);

  const successfulSteps = bundle.steps.filter((step) => step.status === "success").length;
  const failedSteps = bundle.steps.filter((step) => step.status === "failed").length;
  const totalLatencyMs = bundle.steps.reduce((sum, step) => sum + (step.latencyMs ?? 0), 0);
  const outcome =
    bundle.run.status === "complete"
      ? "PR opened"
      : bundle.run.status === "partial"
        ? "Investigation only"
        : bundle.run.status === "needs_auth"
          ? "Needs auth"
          : bundle.run.status === "failed"
            ? "Failed"
            : "In progress";

  function scrollTimeline(direction: -1 | 1) {
    auditTableRef.current?.scrollBy({ left: direction * 280, behavior: "smooth" });
  }

  return (
    <div className="run-console">
      <section className="module run-brief" aria-labelledby="summary-title">
        <div className="module-header">
          <div>
            <h2 className="module-title" id="summary-title">
              {bundle.run.title}
            </h2>
            <p className="module-subtitle">{bundle.run.summary}</p>
          </div>
          <span className={`badge ${bundle.run.status}`}>{bundle.run.status}</span>
        </div>

        <div className="run-metrics" aria-label="Run metrics">
          <div className="metric">
            <span>Outcome</span>
            <strong>{outcome}</strong>
          </div>
          <div className="metric">
            <span>Progress</span>
            <strong>
              {successfulSteps}/{bundle.steps.length || 7}
            </strong>
          </div>
          <div className="metric">
            <span>Failures</span>
            <strong>{failedSteps}</strong>
          </div>
          <div className="metric">
            <span>Tool latency</span>
            <strong>{totalLatencyMs ? `${(totalLatencyMs / 1000).toFixed(1)}s` : "pending"}</strong>
          </div>
          <div className="metric wide">
            <span>Run ID</span>
            <strong className="mono">{bundle.run.id}</strong>
          </div>
          <div className="metric wide">
            <span>Fingerprint</span>
            <strong className="mono">{bundle.run.incidentFingerprint}</strong>
          </div>
        </div>

        {bundle.run.errorMessage ? (
          <div className="run-alert" role="status">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <strong>Run stopped at {outcome.toLowerCase()}</strong>
              <span>{bundle.run.errorMessage}</span>
            </div>
          </div>
        ) : null}
      </section>

      <section className="module evidence-timeline" aria-labelledby="timeline-title">
        <div className="module-header">
          <div>
            <h2 className="module-title" id="timeline-title">
              Execution timeline
            </h2>
            <p className="module-subtitle">Compact audit rows with toolkit, tool slug, log ID, attempts, latency, and message.</p>
            <p className="scroll-hint">Scroll sideways inside the table to inspect clipped columns.</p>
          </div>
          <div className="timeline-actions">
            <button className="icon-button" type="button" onClick={() => scrollTimeline(-1)} aria-label="Scroll timeline left">
              <ChevronLeft size={16} aria-hidden />
            </button>
            <button className="icon-button" type="button" onClick={() => scrollTimeline(1)} aria-label="Scroll timeline right">
              <ChevronRight size={16} aria-hidden />
            </button>
            <a className="button ghost" href={`/api/runs/${bundle.run.id}/export`}>
              <Download size={16} aria-hidden />
              Export JSON
            </a>
          </div>
        </div>

        {bundle.steps.length > 0 ? (
          <div className="audit-table" ref={auditTableRef}>
            <div className="audit-head" aria-hidden>
              <span>Step</span>
              <span>Tool</span>
              <span>Evidence</span>
              <span>Result</span>
            </div>
            {bundle.steps.map((step, index) => {
              const Icon = statusIcon(step.status);
              return (
                <article className={`audit-row ${step.status}`} key={step.id}>
                  <div className="audit-step">
                    <span className="step-index">{index + 1}</span>
                    <div>
                      <strong>{formatStepName(step.step)}</strong>
                      <span className={`badge ${step.status}`}>
                        <Icon size={13} aria-hidden />
                        {step.status}
                      </span>
                    </div>
                  </div>
                  <div className="audit-stack">
                    <span>{step.toolkit}</span>
                    <strong className="mono audit-code">{step.toolSlug}</strong>
                  </div>
                  <div className="audit-stack">
                    <span className="mono audit-code">{step.composioLogId ?? "pending log"}</span>
                    <strong>
                      {step.attempts} {step.attempts === 1 ? "attempt" : "attempts"} · {step.latencyMs == null ? "pending" : `${step.latencyMs}ms`}
                    </strong>
                  </div>
                  <div className="audit-message">
                    <span>{step.message ?? (step.errorCode ? `${step.errorCode}: ${step.status}` : "ok")}</span>
                    <small className="mono">{step.idempotencyKey}</small>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <Loader2 size={32} aria-hidden />
            <h3>Waiting for worker steps</h3>
            <p>The run is queued. Timeline entries will appear as local and Composio steps start.</p>
          </div>
        )}
      </section>

      <aside className="run-sidecar">
        <section className="module" aria-labelledby="proof-title">
          <div className="module-header">
            <div>
              <h2 className="module-title" id="proof-title">
                Proof bundle
              </h2>
              <p className="module-subtitle">External actions, hydrated Composio evidence, and exportable run data.</p>
            </div>
          </div>
          <div className="proof-grid">
            <div className="proof-item">
              <span>External artifacts</span>
              <strong>{bundle.artifacts.filter((artifact) => artifact.kind !== "patch").length}</strong>
            </div>
            <div className="proof-item">
              <span>Composio logs</span>
              <strong>{logs.length}</strong>
            </div>
            <div className="proof-item">
              <span>Patch gate</span>
              <strong>{patchIssues.length ? "Rejected" : patch ? "Passed" : "Pending"}</strong>
            </div>
          </div>
          {logs.length ? (
            <div className="log-list">
              {logs.map((log) => (
                <div className="log-row" key={log.logId}>
                  <span className={`badge ${log.status === "success" ? "success" : "skipped"}`}>{log.status}</span>
                  <strong className="mono">{log.toolSlug}</strong>
                  <span className="mono">{log.logId}</span>
                  {log.warning ? <small>{log.warning}</small> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">Log evidence appears after the hydration step completes.</p>
          )}
        </section>

        <section className="module" aria-labelledby="artifacts-title">
          <div className="module-header">
            <div>
              <h2 className="module-title" id="artifacts-title">
                Artifacts
              </h2>
              <p className="module-subtitle">Durable links created by the run.</p>
            </div>
          </div>
          {bundle.artifacts.length > 0 ? (
            <div className="artifact-list">
              {bundle.artifacts.map((artifact) => {
                const Icon = artifactIcons[artifact.kind];
                const details = artifactDetailRows(artifact, bundle);
                return (
                  <a className="artifact-link" href={artifact.externalUrl} key={artifact.id}>
                    <strong>
                      <Icon size={16} aria-hidden />
                      {artifact.label}
                      <ExternalLink size={14} aria-hidden />
                    </strong>
                    <span>{artifact.kind}</span>
                    <div className="artifact-meta">
                      {details.map((detail) => (
                        <div className="artifact-meta-row" key={`${artifact.id}:${detail.label}`}>
                          <span>{detail.label}</span>
                          <strong className="mono">{detail.value}</strong>
                        </div>
                      ))}
                    </div>
                  </a>
                );
              })}
            </div>
          ) : (
            <div className="empty-state">
              <FileCode2 size={32} aria-hidden />
              <h3>Artifacts pending</h3>
              <p>Linear, GitHub, Slack, Sheets, and patch artifacts appear as the worker advances.</p>
            </div>
          )}
        </section>

        <section className="module" aria-labelledby="patch-title">
          <div className="module-header">
            <div>
              <h2 className="module-title" id="patch-title">
                Patch evidence
              </h2>
              <p className="module-subtitle">Patch source, safety gate, and diff used for the PR path.</p>
            </div>
          </div>
          {patch ? (
            <div className="patch-meta">
              <div>
                <span>Source</span>
                <strong>{valueLabel(patch.source)}</strong>
              </div>
              <div>
                <span>Model</span>
                <strong>{valueLabel(patch.model, "catalog")}</strong>
              </div>
              <div>
                <span>Confidence</span>
                <strong>{valueLabel(patch.confidence)}</strong>
              </div>
              <div>
                <span>Target</span>
                <strong className="mono">{valueLabel(patch.filePath)}</strong>
              </div>
            </div>
          ) : null}
          {patchIssues.length ? (
            <div className="run-alert" role="status">
              <AlertTriangle size={18} aria-hidden />
              <div>
                <strong>Patch rejected before GitHub write</strong>
                <span>{patchIssues.map((issue) => issue.code).join(", ")}</span>
              </div>
            </div>
          ) : null}
          {patchPreview ? (
            <pre className="patch-preview">{patchPreview}</pre>
          ) : (
            <div className="empty-state">
              <FileCode2 size={32} aria-hidden />
              <h3>No patch attached</h3>
              <p>Unknown incidents remain investigation-only, so users never see a fake or empty PR.</p>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
