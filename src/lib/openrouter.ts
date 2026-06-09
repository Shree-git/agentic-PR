import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { Incident } from "./types";
import type { PatchPlan } from "./patch-catalog";

export const OPENROUTER_DEFAULT_MODEL = "deepseek/deepseek-v4-pro";

const generatedPatchSchema = z.object({
  canPatch: z.boolean(),
  title: z.string().min(1),
  suspectedCause: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  filePath: z.string().min(1),
  replacementContent: z.string().min(1),
  diff: z.string().min(1),
  validationNotes: z.array(z.string()).default([])
});

export interface OpenRouterPatchResult {
  patch: PatchPlan | null;
  model: string;
  reasoningTokens: number | null;
  rawResponse: string;
  skippedReason?: string;
}

interface GeneratePatchInput {
  runId: string;
  incident: Incident;
  catalogPatch?: PatchPlan | null;
}

interface RepoContextFile {
  filePath: string;
  content: string;
  exists: boolean;
}

export async function generateOpenRouterPatch(input: GeneratePatchInput): Promise<OpenRouterPatchResult> {
  const model = process.env.OPENROUTER_MODEL ?? OPENROUTER_DEFAULT_MODEL;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    return {
      patch: null,
      model,
      reasoningTokens: null,
      rawResponse: "",
      skippedReason: "OPENROUTER_API_KEY is not configured"
    };
  }

  const { OpenRouter } = await import("@openrouter/sdk");
  const openrouter = new OpenRouter({ apiKey });
  const repoContext = await collectRepoContext(input.incident, input.catalogPatch);

  let rawResponse = "";
  let reasoningTokens: number | null = null;
  const maxAttempts = Number(process.env.OPENROUTER_MAX_ATTEMPTS ?? 3);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const stream = await openrouter.chat.send({
        chatRequest: {
          model: model as any,
          provider: openRouterProviderPreferences(),
          messages: [
            {
              role: "system",
              content:
                "You are a senior incident remediation agent. Return only JSON. Do not wrap JSON in markdown. Generate one concrete code fix only when the evidence and repository context support it."
            },
            {
              role: "user",
              content: buildPatchPrompt(input.runId, input.incident, repoContext, input.catalogPatch)
            }
          ],
          stream: true
        }
      });

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) rawResponse += content;
        if (chunk.usage?.completionTokensDetails?.reasoningTokens != null) {
          reasoningTokens = chunk.usage.completionTokensDetails.reasoningTokens;
        }
      }
      break;
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableOpenRouterError(error)) throw error;
      await delay(750 * attempt);
    }
  }

  const parsed = parseGeneratedPatch(rawResponse);
  if (!parsed.canPatch || parsed.confidence === "low") {
    return {
      patch: null,
      model,
      reasoningTokens,
      rawResponse,
      skippedReason: parsed.canPatch ? "Model confidence was low" : "Model declined to patch"
    };
  }

  const safePath = safeRepoPath(parsed.filePath);
  if (!safePath) {
    return {
      patch: null,
      model,
      reasoningTokens,
      rawResponse,
      skippedReason: "Model returned an unsafe file path"
    };
  }

  return {
    patch: {
      id: `openrouter-${slugify(parsed.title)}`,
      title: parsed.title,
      suspectedCause: parsed.suspectedCause,
      confidence: parsed.confidence,
      source: "openrouter",
      model,
      reasoningTokens,
      branchName: `fix/${slugify(parsed.title)}`,
      filePath: safePath,
      replacementContent: parsed.replacementContent,
      beforeSnippet: repoContext.find((file) => file.filePath === safePath)?.content.slice(0, 1000) ?? "",
      afterSnippet: parsed.replacementContent.slice(0, 1000),
      diff: parsed.diff,
      validationNotes: parsed.validationNotes,
      prBody: ""
    },
    model,
    reasoningTokens,
    rawResponse
  };
}

function openRouterProviderPreferences(): { only?: string[] } | undefined {
  const providers = process.env.OPENROUTER_PROVIDER_ONLY?.split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
  return providers?.length ? { only: providers } : undefined;
}

function isRetryableOpenRouterError(error: unknown): boolean {
  const statusCode = typeof error === "object" && error ? (error as { statusCode?: unknown }).statusCode : undefined;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return statusCode === 429 || statusCode === 529 || message.includes("rate") || message.includes("temporarily");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseGeneratedPatch(rawResponse: string): z.infer<typeof generatedPatchSchema> {
  const json = extractJson(rawResponse);
  return generatedPatchSchema.parse(JSON.parse(json));
}

async function collectRepoContext(incident: Incident, catalogPatch?: PatchPlan | null): Promise<RepoContextFile[]> {
  const candidates = new Set<string>();
  if (catalogPatch?.filePath) candidates.add(catalogPatch.filePath);
  for (const filePath of textFilePaths(`${incident.culprit ?? ""}\n${incident.stackTrace ?? ""}\n${incident.message}`)) {
    candidates.add(filePath);
  }
  candidates.add("package.json");

  const files: RepoContextFile[] = [];
  for (const candidate of [...candidates].slice(0, 6)) {
    const safePath = safeRepoPath(candidate);
    if (!safePath) continue;
    const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), safePath);
    try {
      const content = await fs.readFile(absolutePath, "utf8");
      files.push({ filePath: safePath, content: content.slice(0, 12000), exists: true });
    } catch {
      files.push({ filePath: safePath, content: "", exists: false });
    }
  }
  return files;
}

function buildPatchPrompt(runId: string, incident: Incident, repoContext: RepoContextFile[], catalogPatch?: PatchPlan | null): string {
  return `Incident run: ${runId}

Incident:
${JSON.stringify(
  {
    source: incident.source,
    severity: incident.severity,
    title: incident.title,
    message: incident.message,
    culprit: incident.culprit,
    fingerprint: incident.fingerprint,
    stackTrace: incident.stackTrace,
    context: incident.context
  },
  null,
  2
)}

Repository context:
${repoContext.map(formatRepoFile).join("\n\n")}

${catalogPatch ? `Catalog hint, if useful:\n${JSON.stringify(catalogPatch, null, 2)}` : "No catalog patch matched this incident."}

Return this JSON shape:
{
  "canPatch": true,
  "title": "Short imperative PR title",
  "suspectedCause": "Specific root cause based on incident evidence",
  "confidence": "high",
  "filePath": "relative/path/to/file.ts",
  "replacementContent": "Full replacement file content, not a snippet",
  "diff": "Unified diff for reviewer readability",
  "validationNotes": ["What validation should be run or what limitation remains"]
}

Rules:
- Use canPatch=false when there is not enough repository context to safely produce a code change.
- replacementContent must be the complete file content for filePath because the GitHub tool upserts full files.
- Prefer modifying an existing file from Repository context. Create a new file only if the fix naturally requires one.
- Do not fabricate test results. Put unrun checks in validationNotes.
- Return JSON only.`;
}

function formatRepoFile(file: RepoContextFile): string {
  if (!file.exists) return `File: ${file.filePath}\nStatus: not present in local repository`;
  return `File: ${file.filePath}\n\`\`\`\n${file.content}\n\`\`\``;
}

function textFilePaths(text: string): string[] {
  const matches = text.match(/[A-Za-z0-9_./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|md)/g) ?? [];
  return matches.map((match) => match.replace(/^[./]+/, "")).filter(Boolean);
}

function safeRepoPath(filePath: string): string | null {
  const normalized = path.posix.normalize(filePath.replaceAll("\\", "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../") || path.isAbsolute(normalized)) return null;
  return normalized.replace(/^\.\//, "");
}

function extractJson(rawResponse: string): string {
  const trimmed = rawResponse.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("OpenRouter response did not contain JSON");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}
