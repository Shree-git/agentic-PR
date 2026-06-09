"use client";

import { useState } from "react";
import type { Toolkit } from "@/lib/types";

export function ConnectToolkitButton({ toolkit }: { toolkit: Toolkit }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/setup/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolkit })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? `Failed to connect ${toolkit}`);
      window.location.href = data.redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to connect ${toolkit}`);
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={connect} disabled={busy}>
        {busy ? "Opening..." : `Connect ${toolkit}`}
      </button>
      {error ? <p className="muted">{error}</p> : null}
    </div>
  );
}
