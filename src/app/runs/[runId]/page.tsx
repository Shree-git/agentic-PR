import Link from "next/link";
import { Download, Home } from "lucide-react";
import { notFound } from "next/navigation";
import { RunConsole } from "@/components/RunConsole";
import { getLedger } from "@/lib/ledger";

export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ledger = await getLedger();

  try {
    const bundle = ledger.getBundle(runId);
    return (
      <div className="app-shell run-page">
        <header className="app-chrome">
          <nav className="app-nav" aria-label="Primary">
            <Link className="brand-lockup" href="/">
              <span className="brand-mark">
                <img className="brand-mark-image" src="/icon.png" alt="" aria-hidden />
              </span>
              <span className="brand-copy">
                <span className="brand-name">Incident PR Autopilot</span>
                <span className="brand-meta">Evidence console</span>
              </span>
            </Link>
            <div className="nav-actions">
              <Link className="nav-link" href="/">
                Command
              </Link>
              <Link className="nav-link" href="/setup">
                Setup
              </Link>
              <Link className="button secondary" href={`/api/runs/${bundle.run.id}/export`}>
                <Download size={17} aria-hidden />
                Export JSON
              </Link>
              <Link className="button secondary" href="/">
                <Home size={17} aria-hidden />
                Home
              </Link>
            </div>
          </nav>
        </header>
        <main className="shell">
          <section className="page-hero" aria-labelledby="run-title">
            <div>
              <h1 className="page-title" id="run-title">
                Evidence console
              </h1>
              <p className="page-copy">Run timeline, artifacts, latency, attempts, and Composio execution log IDs.</p>
            </div>
          </section>
          <RunConsole initialBundle={bundle} />
        </main>
      </div>
    );
  } catch {
    notFound();
  }
}
