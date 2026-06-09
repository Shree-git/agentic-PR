import { describe, expect, it } from "vitest";
import { buildRunIntegrationDetails, githubPrBody, SHEETS_AUDIT_HEADERS, sheetAuditRow, slackMessage } from "@/lib/worker";
import { normalizeSlackIncident } from "@/lib/incidents";
import { findPatchPlan } from "@/lib/patch-catalog";
import type { RunRecord, ToolResult } from "@/lib/types";

const run: RunRecord = {
  id: "run_test",
  incidentFingerprint: "fingerprint",
  source: "slack",
  title: "Critical checkout incident",
  summary: "Critical checkout incident",
  status: "running",
  currentStep: "sheets_audit",
  errorMessage: null,
  createdAt: "2026-06-08T12:00:00.000Z",
  updatedAt: "2026-06-08T12:01:00.000Z"
};

const linear: ToolResult = {
  ok: true,
  data: {
    id: "LIN-123",
    url: "https://linear.example/LIN-123",
    title: "Critical checkout incident"
  },
  logId: "log_linear",
  latencyMs: 20
};

const github: ToolResult = {
  ok: true,
  data: {
    id: "PR-123",
    number: 123,
    url: "https://github.example/pull/123",
    title: "Fix checkout crash when session is missing"
  },
  logId: "log_github",
  latencyMs: 30
};

describe("worker integration details", () => {
  it("keeps Google Sheets audit headers and rows aligned", () => {
    const incident = normalizeSlackIncident({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
    });
    const patch = findPatchPlan(incident);

    const details = buildRunIntegrationDetails({ run, incident, patch, linear, github });
    const row = sheetAuditRow(details);

    expect(row).toHaveLength(SHEETS_AUDIT_HEADERS.length);
    expect(row[SHEETS_AUDIT_HEADERS.indexOf("Outcome")]).toBe("pr_opened");
    expect(row[SHEETS_AUDIT_HEADERS.indexOf("GitHub PR Number")]).toBe("123");
  });

  it("includes the Linear link in the GitHub PR body after Linear succeeds", () => {
    const incident = normalizeSlackIncident({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
    });
    const patch = findPatchPlan(incident);
    expect(patch).not.toBeNull();

    const details = buildRunIntegrationDetails({ run, incident, patch, linear });
    const body = githubPrBody(details, incident, patch!);

    expect(body).toContain("https://linear.example/LIN-123");
    expect(body).toContain("Patch ID: checkout-null-session");
    expect(body).toContain("remains a draft for human review");
  });

  it("formats Slack text for PR and investigation-only outcomes", () => {
    const incident = normalizeSlackIncident({
      text: "Critical checkout incident: Cannot read properties of undefined (reading 'user') in checkout session path"
    });
    const patch = findPatchPlan(incident);
    const prDetails = buildRunIntegrationDetails({ run, incident, patch, linear, github });
    const investigationDetails = buildRunIntegrationDetails({ run, incident, patch: null, linear });

    expect(slackMessage(prDetails)).toContain("GitHub PR: https://github.example/pull/123");
    expect(slackMessage(prDetails)).toContain("review the draft PR");
    expect(slackMessage(investigationDetails)).toContain("GitHub PR: not opened");
    expect(slackMessage(investigationDetails)).toContain("no safe PR was opened");
  });
});
