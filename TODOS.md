# TODOs

## P2: Add fixture-based generated-patch evals

What: Add deterministic generated-patch fixtures for valid full-file output, snippet rejection, unsafe path rejection, malformed JSON, low confidence, and catalog fallback.

Why: Unit tests now protect the validator, but they do not measure whether prompt/model changes keep producing usable full-file patches over time.

Context: The June 2026 live smoke run proved that a model can return snippet content even when prompted for a full replacement file. The current implementation rejects that before GitHub writes, but future prompt/model changes should be evaluated against representative outputs.

Depends on: Current patch validation gate in `src/lib/patch-validation.ts`.
