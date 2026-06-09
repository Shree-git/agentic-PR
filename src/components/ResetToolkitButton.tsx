"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Toolkit } from "@/lib/types";

export function ResetToolkitButton({ toolkit, label = "Reset connection" }: { toolkit: Toolkit; label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reset() {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/setup/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ toolkit })
      });
      const data = await response.json();

      if (!response.ok) throw new Error(data.error ?? `Failed to reset ${toolkit}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to reset ${toolkit}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connect-action">
      <button className="button ghost danger" type="button" onClick={reset} disabled={busy} title={`Reset ${toolkit} so it can be connected again`}>
        {busy ? <Loader2 size={16} aria-hidden /> : <RotateCcw size={16} aria-hidden />}
        {busy ? "Resetting" : label}
      </button>
      {error ? <p className="error-note">{error}</p> : null}
    </div>
  );
}
