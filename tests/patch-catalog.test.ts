import { describe, expect, it } from "vitest";
import { normalizeSlackIncident } from "@/lib/incidents";
import { findPatchPlan } from "@/lib/patch-catalog";

describe("patch catalog", () => {
  it("returns a real patch and suspected cause for known checkout session incidents", () => {
    const incident = normalizeSlackIncident({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
    });

    const patch = findPatchPlan(incident);

    expect(patch).not.toBeNull();
    expect(patch?.diff).toContain("redirect('/login?next=/checkout')");
    expect(patch?.suspectedCause).toContain("session object");
    expect(patch?.prBody).toContain("Suspected cause");
  });

  it("does not invent a PR patch for unknown incidents", () => {
    const incident = normalizeSlackIncident({
      text: "Search results load slowly for enterprise accounts"
    });

    expect(findPatchPlan(incident)).toBeNull();
  });
});
