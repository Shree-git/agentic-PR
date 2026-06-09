import Link from "next/link";
import { checkReadiness } from "@/lib/composio";

export default async function SetupPage() {
  const readiness = await checkReadiness();

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>Setup</h1>
          <p>Composio readiness gate for the five required app connections.</p>
        </div>
        <Link className="button secondary" href="/">
          Home
        </Link>
      </header>

      <section className="panel">
        <div className="row-title">
          <h2>Mode: {readiness.mode}</h2>
          <span className={`badge ${readiness.ready ? "complete" : "failed"}`}>{readiness.ready ? "ready" : "blocked"}</span>
        </div>
        <p className="muted">User ID: {readiness.userId}</p>
        <ul className="list">
          {readiness.toolkits.map((toolkit) => (
            <li key={toolkit.toolkit} className="row">
              <div className="row-title">
                <span>{toolkit.toolkit}</span>
                <span className={`badge ${toolkit.connected ? "success" : "failed"}`}>
                  {toolkit.connected ? "connected" : "missing"}
                </span>
              </div>
              {toolkit.reason ? <p className="muted">{toolkit.reason}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
