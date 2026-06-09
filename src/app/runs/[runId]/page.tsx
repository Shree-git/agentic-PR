import Link from "next/link";
import { notFound } from "next/navigation";
import { RunConsole } from "@/components/RunConsole";
import { getLedger } from "@/lib/ledger";

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const ledger = await getLedger();

  try {
    const bundle = ledger.getBundle(runId);
    return (
      <main className="shell">
        <header className="topbar">
          <div className="brand">
            <h1>Evidence console</h1>
            <p>Run timeline, artifacts, and Composio execution log IDs.</p>
          </div>
          <Link className="button secondary" href="/">
            Home
          </Link>
        </header>
        <RunConsole initialBundle={bundle} />
      </main>
    );
  } catch {
    notFound();
  }
}
