import Link from "next/link";
import type { ComponentType } from "react";
import {
  ClipboardCheck,
  ExternalLink,
  GitPullRequestArrow,
  Home,
  MessageSquare,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  Table2,
  TriangleAlert
} from "lucide-react";
import { checkReadiness } from "@/lib/composio";
import { ConnectToolkitButton } from "@/components/ConnectToolkitButton";
import type { Toolkit } from "@/lib/types";

export const dynamic = "force-dynamic";

const toolkitMeta: Record<Toolkit, { label: string; requiredFor: string; icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }> }> = {
  sentry: { label: "Sentry", requiredFor: "Incident trigger", icon: TriangleAlert },
  linear: { label: "Linear", requiredFor: "Investigation issue", icon: ClipboardCheck },
  github: { label: "GitHub", requiredFor: "Validated pull request", icon: GitPullRequestArrow },
  slack: { label: "Slack", requiredFor: "Responder update", icon: MessageSquare },
  googlesheets: { label: "Google Sheets", requiredFor: "Audit ledger row", icon: Table2 }
};

type MatrixRow = {
  id: string;
  type: "Toolkit" | "Preflight";
  label: string;
  sublabel: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  statusLabel: string;
  statusClass: "connected" | "missing" | "blocked" | "partial";
  requirement: string;
  reason: string;
  blocked: boolean;
  priority: number;
  toolkit?: Toolkit;
};

export default async function SetupPage() {
  const readiness = await checkReadiness();
  const connected = readiness.toolkits.filter((toolkit) => toolkit.connected).length;
  const missingToolkits = readiness.toolkits.filter((toolkit) => !toolkit.connected).length;
  const failedRequiredChecks = readiness.preflight.filter((check) => check.required && !check.ok).length;
  const blockerCount = missingToolkits + failedRequiredChecks;
  const advisoryChecks = readiness.preflight.filter((check) => !check.required);
  const advisoryCount = advisoryChecks.filter((check) => !check.ok).length;
  const matrixRows: MatrixRow[] = [
    ...readiness.toolkits.map((toolkit, index) => {
      const meta = toolkitMeta[toolkit.toolkit];
      return {
        id: `toolkit-${toolkit.toolkit}`,
        type: "Toolkit" as const,
        label: meta.label,
        sublabel: toolkit.toolkit,
        icon: meta.icon,
        statusLabel: toolkit.connected ? "Connected" : "Missing",
        statusClass: toolkit.connected ? ("connected" as const) : ("missing" as const),
        requirement: meta.requiredFor,
        reason: toolkit.reason ?? (toolkit.connected ? "Authorized for live execution." : "Connect this account before real runs."),
        blocked: !toolkit.connected,
        priority: index,
        toolkit: toolkit.toolkit
      };
    }),
    ...readiness.preflight.filter((check) => check.required).map((check, index) => ({
      id: `preflight-${check.key}`,
      type: "Preflight" as const,
      label: check.label,
      sublabel: "required",
      icon: check.ok ? ShieldCheck : ShieldAlert,
      statusLabel: check.ok ? "Pass" : "Blocked",
      statusClass: check.ok ? ("connected" as const) : ("blocked" as const),
      requirement: "Required for judge run",
      reason: check.reason ?? "Ready",
      blocked: !check.ok,
      priority: readiness.toolkits.length + index
    }))
  ].sort((a, b) => {
    const rank = (row: MatrixRow) => {
      if (row.blocked) return 0;
      if (row.type === "Toolkit") return 1;
      if (row.statusClass === "partial") return 2;
      return 3;
    };
    const rankDelta = rank(a) - rank(b);
    if (rankDelta !== 0) return rankDelta;
    if (a.blocked !== b.blocked) return a.blocked ? -1 : 1;
    return a.priority - b.priority;
  });
  const firstBlocker = matrixRows.find((row) => row.blocked);
  const runMessage = readiness.judgeReady
    ? "All required accounts and preflight checks are ready. Start the judge demo from the command center."
    : firstBlocker
      ? `${firstBlocker.label} is the first blocker to clear before judge execution.`
      : "Refresh readiness, then start the run from Command.";

  return (
    <div className="app-shell setup-page">
      <header className="app-chrome">
        <nav className="app-nav" aria-label="Primary">
          <Link className="brand-lockup" href="/">
            <span className="brand-mark">
              <img className="brand-mark-image" src="/icon.png" alt="" aria-hidden />
            </span>
            <span className="brand-copy">
              <span className="brand-name">Incident PR Autopilot</span>
              <span className="brand-meta">Readiness gate</span>
            </span>
          </Link>
          <div className="nav-actions">
            <Link className="nav-link" href="/">
              Command
            </Link>
            <Link className="nav-link active" href="/setup">
              Setup
            </Link>
            <Link className="button secondary" href="/">
              <Home size={17} aria-hidden />
              Home
            </Link>
          </div>
        </nav>
      </header>

      <main className="shell">
        <section className="page-hero setup-hero" aria-labelledby="setup-title">
          <div>
            <h1 className="page-title" id="setup-title">
              Setup readiness
            </h1>
            <p className="page-copy">
              Dense readiness control for Composio apps, target configuration, and judge-run tool availability.
            </p>
          </div>
        </section>

        <section className="module setup-workbench" aria-labelledby="matrix-title">
          <div className="setup-toolbar" aria-label="Readiness summary">
            <div className="setup-gate">
              {readiness.judgeReady ? <ShieldCheck size={18} aria-hidden /> : <ShieldAlert size={18} aria-hidden />}
              <div>
                <span>Overall gate</span>
                <strong>{readiness.judgeReady ? "Ready" : "Blocked"}</strong>
              </div>
            </div>
            <div className="setup-toolbar-metrics">
              <div className="setup-metric">
                <span>Mode</span>
                <strong>{readiness.mode}</strong>
              </div>
              <div className="setup-metric">
                <span>User</span>
                <strong className="mono">{readiness.userId}</strong>
              </div>
              <div className="setup-metric">
                <span>Connected</span>
                <strong>
                  {connected}/{readiness.toolkits.length}
                </strong>
              </div>
              <div className="setup-metric">
                <span>Blockers</span>
                <strong>{blockerCount}</strong>
              </div>
            </div>
            <Link className="button ghost setup-refresh" href="/setup">
              <RefreshCcw size={16} aria-hidden />
              Refresh
            </Link>
          </div>

          <div className={`setup-alert ${readiness.judgeReady ? "is-ready" : "is-blocked"}`}>
            <span className={`badge ${readiness.judgeReady ? "complete" : "blocked"}`}>{readiness.judgeReady ? "judge ready" : "blocked"}</span>
            <p>{runMessage}</p>
          </div>

          <div className="module-header setup-matrix-header">
            <div>
              <h2 className="module-title" id="matrix-title">
                Readiness matrix
              </h2>
              <p className="module-subtitle">Required configuration and connected apps for the judge run.</p>
            </div>
            <span className="status-copy">{matrixRows.length} checks</span>
          </div>

          <div className="setup-matrix" role="table" aria-label="Setup readiness matrix">
            <div className="setup-matrix-head" role="row">
              <span role="columnheader">Item</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Requirement</span>
              <span role="columnheader">Reason</span>
              <span role="columnheader">Action</span>
            </div>

            {matrixRows.map((row) => {
              const Icon = row.icon;
              return (
                <div className={`setup-matrix-row ${row.blocked ? "is-blocked" : ""}`} key={row.id} role="row">
                  <div className="setup-matrix-item" role="cell">
                    <span className="toolkit-icon" aria-hidden>
                      <Icon size={17} aria-hidden />
                    </span>
                    <div>
                      <strong>{row.label}</strong>
                      <span>
                        {row.type} · {row.sublabel}
                      </span>
                    </div>
                  </div>
                  <span className={`badge ${row.statusClass}`} role="cell">
                    {row.statusLabel}
                  </span>
                  <span className="status-copy" role="cell">
                    {row.requirement}
                  </span>
                  <span className="setup-reason" role="cell">
                    {row.reason}
                  </span>
                  <div className="setup-action" role="cell">
                    {row.toolkit && row.blocked && readiness.mode === "real" ? (
                      <ConnectToolkitButton toolkit={row.toolkit} label={`Connect ${row.label}`} />
                    ) : row.toolkit && row.blocked ? (
                      <span className="status-copy">Mock mode</span>
                    ) : row.blocked ? (
                      <span className="status-copy">Set config</span>
                    ) : (
                      <span className="status-copy">No action</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {advisoryChecks.length > 0 ? (
            <details className="setup-diagnostics">
              <summary>
                Optional diagnostics
                {advisoryCount > 0 ? <span>{advisoryCount} schema check{advisoryCount === 1 ? "" : "s"} not confirmed by SDK discovery</span> : <span>All advisory checks passed</span>}
              </summary>
              <div className="setup-diagnostics-list">
                {advisoryChecks.map((check) => (
                  <div className="setup-diagnostic-row" key={check.key}>
                    <span className={`badge ${check.ok ? "connected" : "partial"}`}>{check.ok ? "Pass" : "Review"}</span>
                    <strong>{check.label}</strong>
                    <p>{check.reason ?? "Ready"}</p>
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          <div className="setup-next">
            <span>
              {readiness.judgeReady ? <ShieldCheck size={18} aria-hidden /> : <ShieldAlert size={18} aria-hidden />}
              {readiness.judgeReady ? "Ready path" : "Blocked path"}
            </span>
            <p>{readiness.judgeReady ? "Return to Command and start a judge run. Validated incidents can create issues, commits, pull requests, Slack updates, and ledger rows." : "Clear missing toolkits and required preflight checks, refresh readiness, then start the run from Command."}</p>
            <Link className="button secondary" href="/">
              <ExternalLink size={16} aria-hidden />
              Command
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
