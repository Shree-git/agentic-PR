import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  CircleDot,
  ClipboardList,
  FileCode2,
  GitPullRequestArrow,
  MessageSquare,
  RadioTower,
  ShieldCheck,
  Table2
} from "lucide-react";
import { DemoLauncher } from "@/components/DemoLauncher";
import { getLedger } from "@/lib/ledger";
import type { RunRecord } from "@/lib/types";

export const dynamic = "force-dynamic";

const pipeline = [
  { label: "Incident", detail: "Slack or Sentry trigger", icon: RadioTower },
  { label: "OpenRouter patch", detail: "Kimi fix planning", icon: BookOpenCheck },
  { label: "Linear issue", detail: "Investigation record", icon: ClipboardList },
  { label: "GitHub PR", detail: "Only when safe", icon: GitPullRequestArrow },
  { label: "Slack update", detail: "Responder context", icon: MessageSquare },
  { label: "Sheets audit", detail: "Durable ledger row", icon: Table2 },
  { label: "Composio logs", detail: "Tool evidence IDs", icon: FileCode2 }
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function outcomeForRun(run: RunRecord) {
  if (run.status === "complete") return "PR opened";
  if (run.status === "partial") return "Investigation only";
  if (run.status === "needs_auth") return "Auth blocked";
  if (run.status === "failed") return "Failed";
  return "In progress";
}

export default async function HomePage() {
  const ledger = await getLedger();
  const runs = ledger.listRuns();

  return (
    <div className="app-shell">
      <header className="app-chrome">
        <nav className="app-nav" aria-label="Primary">
          <Link className="brand-lockup" href="/">
            <span className="brand-mark">
              <img className="brand-mark-image" src="/icon.png" alt="" aria-hidden />
            </span>
            <span className="brand-copy">
              <span className="brand-name">Incident PR Autopilot</span>
              <span className="brand-meta">Auditable automation</span>
            </span>
          </Link>
          <div className="nav-actions">
            <Link className="nav-link active" href="/">
              Command
            </Link>
            <Link className="nav-link" href="/setup">
              Setup
            </Link>
            <Link className="button secondary" href="/setup">
              <ShieldCheck size={17} aria-hidden />
              Readiness
            </Link>
          </div>
        </nav>
      </header>

      <main className="shell">
        <section className="page-hero" aria-labelledby="home-title">
          <div>
            <h1 className="page-title" id="home-title">
              Incident response that opens PRs only when the evidence is strong.
            </h1>
            <p className="page-copy">
              Composio coordinates Linear, GitHub, Slack, Sheets, and execution logs into one judge-ready audit trail.
            </p>
          </div>
        </section>

        <div className="workspace">
          <section className="module flat" aria-labelledby="pipeline-title">
            <div className="module-header">
              <div>
                <h2 className="module-title" id="pipeline-title">
                  Incident-to-PR execution path
                </h2>
                <p className="module-subtitle">Every transition leaves an artifact, a tool slug, or a log ID.</p>
              </div>
            </div>
            <div className="pipeline">
              {pipeline.map((step) => {
                const Icon = step.icon;
                return (
                  <div className="pipeline-step" key={step.label}>
                    <span className="pipeline-icon">
                      <Icon size={18} aria-hidden />
                    </span>
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <div className="command-grid">
            <DemoLauncher />

            <section className="module" aria-labelledby="contract-title">
              <div className="module-header">
                <div>
                  <h2 className="module-title" id="contract-title">
                    Execution contract
                  </h2>
                  <p className="module-subtitle">The agent is allowed to act only inside these rails.</p>
                </div>
              </div>
              <div className="contract-list">
                <div className="contract-item">
                  <CheckCircle2 size={34} aria-hidden />
                  <div>
                    <strong>Generated fixes create PRs</strong>
                    <span>GitHub opens after OpenRouter returns a structured fix or the catalog fallback matches.</span>
                  </div>
                </div>
                <div className="contract-item">
                  <CircleDot size={34} aria-hidden />
                  <div>
                    <strong>Unknown incidents become investigation issues</strong>
                    <span>No empty PRs, no fabricated patches, and no ungrounded remediation claims.</span>
                  </div>
                </div>
                <div className="contract-item">
                  <FileCode2 size={34} aria-hidden />
                  <div>
                    <strong>Every tool call is traceable</strong>
                    <span>Composio log IDs, latency, attempts, and artifacts stay attached to the run.</span>
                  </div>
                </div>
              </div>
            </section>
          </div>

          <section className="module table-panel runs-table" aria-labelledby="runs-title">
            <div className="module-header">
              <div>
                <h2 className="module-title" id="runs-title">
                  Recent runs
                </h2>
                <p className="module-subtitle">Open any run for its evidence console and exportable audit log.</p>
              </div>
            </div>
            {runs.length > 0 ? (
              <>
                <div className="table-head" aria-hidden>
                  <span>Incident</span>
                  <span>Status</span>
                  <span>Outcome</span>
                  <span>Updated</span>
                </div>
                {runs.map((run) => (
                  <Link className="run-row" href={`/runs/${run.id}`} key={run.id}>
                    <span className="row-title">
                      <strong>{run.title}</strong>
                      <span className="run-id">{run.id}</span>
                    </span>
                    <span className={`badge ${run.status}`}>{run.status}</span>
                    <span>{outcomeForRun(run)}</span>
                    <span className="muted">{formatDate(run.updatedAt)}</span>
                  </Link>
                ))}
              </>
            ) : (
              <div className="empty-state">
                <RadioTower size={34} aria-hidden />
                <h3>No runs yet</h3>
                <p>Start the judge demo to produce a full incident, patch plan, artifact trail, and evidence console.</p>
                <ArrowRight size={18} aria-hidden />
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
