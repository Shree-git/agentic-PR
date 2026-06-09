import Link from "next/link";
import { DemoLauncher } from "@/components/DemoLauncher";
import { getLedger } from "@/lib/ledger";

export default async function HomePage() {
  const ledger = await getLedger();
  const runs = ledger.listRuns();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Incident PR Autopilot</h1>
          <p>Composio-powered agent that turns incidents into auditable workflow execution.</p>
        </div>
        <nav className="nav">
          <Link className="button secondary" href="/setup">
            Setup
          </Link>
        </nav>
      </header>

      <div className="grid">
        <DemoLauncher />
        <section className="panel">
          <h2>Execution contract</h2>
          <p className="muted">
            The agent opens a GitHub PR only when a validated patch catalog entry matches. Unknown incidents become investigation issues, never empty PRs.
          </p>
        </section>
      </div>

      <section className="panel" style={{ marginTop: 18 }}>
        <h2>Recent runs</h2>
        <ul className="list">
          {runs.map((run) => (
            <li key={run.id} className="row">
              <Link href={`/runs/${run.id}`}>
                <div className="row-title">
                  <span>{run.title}</span>
                  <span className={`badge ${run.status}`}>{run.status}</span>
                </div>
                <p className="muted">{run.id}</p>
              </Link>
            </li>
          ))}
          {runs.length === 0 ? <li className="muted">No runs yet. Start the judge demo.</li> : null}
        </ul>
      </section>
    </main>
  );
}
