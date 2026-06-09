import fs from "node:fs";
import path from "node:path";
import type { PatchPlan } from "./patch-catalog";

export interface PatchValidationIssue {
  code:
    | "LOW_CONFIDENCE"
    | "UNSAFE_PATH"
    | "MISSING_CONTENT"
    | "SNIPPET_CONTENT"
    | "DIFF_MISMATCH"
    | "EMPTY_DIFF";
  message: string;
}

export type PatchValidationResult =
  | { ok: true; patch: PatchPlan; issues: [] }
  | { ok: false; patch: PatchPlan | null; issues: PatchValidationIssue[] };

export function validatePatchForPr(patch: PatchPlan | null, repoRoot = process.cwd()): PatchValidationResult {
  if (!patch) {
    return { ok: false, patch: null, issues: [{ code: "MISSING_CONTENT", message: "No patch is available." }] };
  }

  const issues: PatchValidationIssue[] = [];
  const safePath = safeRepoPath(patch.filePath);
  const replacementContent = patch.replacementContent?.trimEnd();
  const diff = patch.diff?.trim();

  if (patch.confidence === "low") {
    issues.push({ code: "LOW_CONFIDENCE", message: "Low-confidence generated patches must not open PRs." });
  }

  if (!safePath) {
    issues.push({ code: "UNSAFE_PATH", message: "Patch file path must stay inside the repository." });
  }

  if (!replacementContent) {
    issues.push({ code: "MISSING_CONTENT", message: "Patch must include full replacement file content." });
  }

  if (!diff) {
    issues.push({ code: "EMPTY_DIFF", message: "Patch must include a reviewer-readable diff." });
  }

  if (safePath && replacementContent) {
    const existingContent = readExistingContent(repoRoot, safePath);
    if (looksLikeSnippet(replacementContent, existingContent)) {
      issues.push({
        code: "SNIPPET_CONTENT",
        message: "Replacement content looks like a snippet instead of a complete file."
      });
    }
  }

  if (replacementContent && diff && !diffMentionsReplacement(diff, replacementContent)) {
    issues.push({
      code: "DIFF_MISMATCH",
      message: "Diff does not appear to describe the replacement content."
    });
  }

  if (issues.length) return { ok: false, patch, issues };
  return { ok: true, patch: { ...patch, filePath: safePath! }, issues: [] };
}

function safeRepoPath(filePath: string): string | null {
  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.isAbsolute(normalized)) return null;
  return normalized.replace(/^\.\//, "");
}

function readExistingContent(repoRoot: string, filePath: string): string | null {
  try {
    return fs.readFileSync(path.join(repoRoot, filePath), "utf8");
  } catch {
    return null;
  }
}

function looksLikeSnippet(content: string, existingContent: string | null): boolean {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 8) return true;

  if (existingContent) {
    const existingLines = existingContent.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
    if (existingLines >= 12 && lines.length < Math.max(8, Math.floor(existingLines * 0.5))) return true;
  }

  const moduleSignals = /\b(import|export|function|class|const|let|var|interface|type)\b/.test(content);
  const structuredSignals = /[{};]/.test(content);
  return !moduleSignals || !structuredSignals;
}

function diffMentionsReplacement(diff: string, replacementContent: string): boolean {
  const replacementLines = replacementContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 8)
    .slice(0, 5);

  if (!replacementLines.length) return false;
  return replacementLines.some((line) => diff.includes(line));
}
