import { describe, expect, it } from "vitest";
import { parseGeneratedPatch } from "@/lib/openrouter";

describe("OpenRouter patch parsing", () => {
  it("parses a fenced JSON patch response", () => {
    const patch = parseGeneratedPatch(`\`\`\`json
{
  "canPatch": true,
  "title": "Guard missing checkout session",
  "suspectedCause": "Checkout reads session.user.id before checking that session exists.",
  "confidence": "high",
  "filePath": "src/app/checkout/actions.ts",
  "replacementContent": "export async function checkout() {}\\n",
  "diff": "diff --git a/src/app/checkout/actions.ts b/src/app/checkout/actions.ts",
  "validationNotes": ["Run npm test"]
}
\`\`\``);

    expect(patch.canPatch).toBe(true);
    expect(patch.filePath).toBe("src/app/checkout/actions.ts");
    expect(patch.validationNotes).toEqual(["Run npm test"]);
  });
});
