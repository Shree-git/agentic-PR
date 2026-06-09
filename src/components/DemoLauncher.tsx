"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DemoLauncher() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startDemo() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path",
          user_name: "demo_judge",
          channel_name: "incident-response"
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Failed to start demo");
      router.push(`/runs/${data.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start demo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Run the judge demo</h2>
      <p className="muted">
        Starts the Slack fallback trigger. In mock mode it still exercises the same ledger, worker, patch catalog, and evidence console.
      </p>
      <button onClick={startDemo} disabled={busy}>
        {busy ? "Starting..." : "Start incident-to-PR run"}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
