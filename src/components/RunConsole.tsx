"use client";

import { useEffect, useState } from "react";
import type { RunBundle } from "@/lib/types";

export function RunConsole({ initialBundle }: { initialBundle: RunBundle }) {
  const [bundle, setBundle] = useState(initialBundle);

  useEffect(() => {
    if (["complete", "failed", "partial", "needs_auth"].includes(bundle.run.status)) return;
    const id = setInterval(async () => {
      const response = await fetch(`/api/runs/${bundle.run.id}`, { cache: "no-store" });
      if (response.ok) setBundle(await response.json());
    }, 1200);
    return () => clearInterval(id);
  }, [bundle.run.id, bundle.run.status]);

  return (
    <div className="grid">
      <section className="panel">
        <div className="row-title">
          <h2>{bundle.run.title}</h2>
          <span className={`badge ${bundle.run.status}`}>{bundle.run.status}</span>
        </div>
        <p className="muted">{bundle.run.summary}</p>
        <dl className="kv">
          <dt>Run ID</dt>
          <dd>{bundle.run.id}</dd>
          <dt>Fingerprint</dt>
          <dd>{bundle.run.incidentFingerprint}</dd>
          <dt>Source</dt>
          <dd>{bundle.run.source}</dd>
          <dt>Updated</dt>
          <dd>{bundle.run.updatedAt}</dd>
        </dl>
        {bundle.run.errorMessage ? <p className="muted">{bundle.run.errorMessage}</p> : null}
      </section>

      <section className="panel">
        <h2>Artifacts</h2>
        <ul className="list">
          {bundle.artifacts.map((artifact) => (
            <li key={artifact.id} className="row">
              <div className="row-title">
                <span>{artifact.label}</span>
                <span className="muted">{artifact.kind}</span>
              </div>
              <a href={artifact.externalUrl}>{artifact.externalUrl}</a>
            </li>
          ))}
          {bundle.artifacts.length === 0 ? <li className="muted">Artifacts appear as the worker advances.</li> : null}
        </ul>
      </section>

      <section className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="row-title">
          <h2>Execution timeline</h2>
          <a className="button secondary" href={`/api/runs/${bundle.run.id}/export`}>
            Export JSON
          </a>
        </div>
        <div className="timeline">
          {bundle.steps.map((step) => (
            <article key={step.id} className={`step ${step.status}`}>
              <span className={`badge ${step.status}`}>{step.status}</span>
              <div>
                <h3>{step.step}</h3>
                <dl className="kv">
                  <dt>Toolkit</dt>
                  <dd>{step.toolkit}</dd>
                  <dt>Tool</dt>
                  <dd>{step.toolSlug}</dd>
                  <dt>Log ID</dt>
                  <dd>{step.composioLogId ?? "pending"}</dd>
                  <dt>Attempts</dt>
                  <dd>{step.attempts}</dd>
                  <dt>Latency</dt>
                  <dd>{step.latencyMs == null ? "pending" : `${step.latencyMs}ms`}</dd>
                  <dt>Message</dt>
                  <dd>{step.message ?? "ok"}</dd>
                </dl>
              </div>
            </article>
          ))}
          {bundle.steps.length === 0 ? <p className="muted">Waiting for worker steps...</p> : null}
        </div>
      </section>
    </div>
  );
}
