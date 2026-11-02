# Failures & Incident Log

This document records real bugs, edge-case failures, and architectural issues discovered during development and testing, along with root causes and fixes.

---

## Log Template

```markdown
### [YYYY-MM-DD] Short Failure Title

- **Phase:** Phase X
- **Symptom:** What happened (error message, test failure, unexpected behavior).
- **Cause:** Why it happened (root cause analysis).
- **Fix:** What change resolved it and how it was verified.
```

---

### [2026-11-03] Model Substring Collision in Cost Accounting

- **Phase:** Phase 2 (LLM Layer)
- **Symptom:** Unit test for `estimateCostUsd('gpt-4o-mini', 1000, 1000)` returned \$0.0125 instead of \$0.00075.
- **Cause:** `MODEL_PRICING` keys were checked via `.find()` with substring matching (`model.includes(key)`). Because `'gpt-4o'` appeared before `'gpt-4o-mini'` in the pricing table, `'gpt-4o-mini'.includes('gpt-4o')` evaluated to `true`, mistakenly applying the full `gpt-4o` pricing tier.
- **Fix:** Implemented a two-stage lookup: first an exact dictionary lookup, followed by sorting pricing table keys by length in descending order so more specific model identifiers (e.g. `'gpt-4o-mini'`) are matched before their shorter substrings (`'gpt-4o'`).

---

### [2026-11-03] Citation Marker Removal Trailing Whitespace

- **Phase:** Phase 2 (Writer Agent)
- **Symptom:** Parsed claims had a leading space before sentence-ending punctuation (e.g. `"TypeScript 5.0 introduced ... inference ."` instead of `"inference."`).
- **Cause:** The regex stripped citation markers like ` [n1]` by replacing `[n1]` with empty string, leaving behind the leading space before the terminating punctuation mark.
- **Fix:** Added `.replace(/\s+([.,!?;:])/g, '$1')` in `citationParser.ts` to collapse spaces preceding punctuation.

---
