"use client";

import { AlertTriangle, ArrowRight, Loader2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReadinessCheck } from "@/lib/types";

export function DemoLauncher() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ReadinessCheck | null>(null);

  useEffect(() => {
    let mounted = true;
    fetch("/api/setup/status", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (mounted) setReadiness(data);
      })
      .catch(() => {
        if (mounted) setReadiness(null);
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function startDemo() {
    if (readiness && !readiness.judgeReady) {
      setError(readiness.preflight.find((item) => item.required && !item.ok)?.reason ?? "Judge demo requires real Composio readiness.");
      return;
    }

    setBusy(true);
    setError(null);
    const runStamp = new Date().toISOString();
    try {
      const response = await fetch("/api/demo/slack", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: `Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path. Live demo ${runStamp}.`,
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
    <section className="module dark demo-card" aria-labelledby="demo-title">
      <div className="module-header">
        <div>
          <h2 className="module-title" id="demo-title">
            Run the judge demo
          </h2>
          <p className="module-subtitle">
            Starts the Slack fallback trigger only when real Composio readiness and target preflight pass.
          </p>
        </div>
        <Play size={22} aria-hidden />
      </div>

      <div className="readiness-strip" aria-label="Judge readiness">
        <span className={`badge ${readiness?.mode === "real" ? "connected" : "missing"}`}>{readiness?.mode ?? "checking"} mode</span>
        <span className={`badge ${readiness?.judgeReady ? "complete" : "blocked"}`}>
          {readiness?.judgeReady ? "judge ready" : "judge blocked"}
        </span>
      </div>

      <div className="incident-preview" aria-label="Demo incident payload">
        <code>Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path</code>
      </div>

      <button className="button" onClick={startDemo} disabled={busy || readiness?.judgeReady === false}>
        {busy ? <Loader2 size={17} aria-hidden /> : <ArrowRight size={17} aria-hidden />}
        {busy ? "Starting run" : readiness?.judgeReady === false ? "Complete setup first" : "Start incident-to-PR run"}
      </button>

      {error ? (
        <p className="error-note">
          <AlertTriangle size={16} aria-hidden /> {error}
        </p>
      ) : null}
    </section>
  );
}
