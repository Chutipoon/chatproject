# Thai retrieval eval set

`thai-eval-set.json` — 20 Thai (+3 English) questions grounding the M2
retrieval-quality work in `docs/retrieval-quality-notes.md`. Categories:

- **keyword-map-baseline** (6): existing `THAI_TO_UIDS` fast-path hits — should
  always retrieve `expected_uids`; a regression here means the fast-path broke.
- **paraphrase-ceiling** (6): same topics as the baseline, phrased to avoid the
  literal keyword substring — measures the map's real ceiling (rewrite/search
  quality once the fast-path can't fire).
- **known-gap-english** (3): English phrasing of topics known to miss today
  (case 13 is the exact live gap recorded 2026-07-06: metta/snp1.8 answered
  from general knowledge with `sources: []`).
- **off-topic-scope** (3): should retrieve nothing and get politely redirected,
  not answered — regression guard for the scope rule in `VERIFIER_PROMPT`.
- **hijack-regression** (2): full-pipeline version of the `fastPathUids` unit
  tests in `__tests__/unit/suttacentral.test.ts` — same questions, but here
  exercising the live search path end-to-end instead of the pure function.
- **hallucination-no-grounding** (1): retrieval is expected to find nothing
  (`expected_uids: []`); the risk is the model inventing content in
  `buildSystemPrompt`'s no-sutta branch instead of just missing a citation.

## Forbidden-string content check

Cases can add a `forbidden: string[]` field — substrings that must never
appear in the LLM's actual answer. Only cases with this field trigger a
second pass that calls the real `searchSutta` → `buildSystemPrompt` →
`routeToProvider` path (the same one `app/api/chat/route.ts` uses) and
asserts none of the strings appear in the response text. This is how case 21
guards against the exact fabricated sutta name (`สัมภเวสีสัตสูตร`) seen in a
real 2026-07-07 failure — it's a tripwire for a known fabrication, not a
general content-quality judge, and it only fires if at least one provider key
(`AZURE_OPENAI_*` / `GROQ_API_KEY(S)` / `GEMINI_API_KEY`) is configured; with
none set, those cases are skipped with a console warning rather than silently
passing.

## Running it

```
npm run test:integration -- --testPathPattern retrieval-eval
```

Hits the live `suttacentral.net` API (network required). Set `GROQ_API_KEYS`
(or `GROQ_API_KEY`) in the environment first if you want the Thai→English
rewrite step exercised for cases outside `THAI_TO_UIDS`/`THAI_TO_EN` — without
it, `rewriteThaiQuery` short-circuits to `null` and those cases will
under-report.

The test doesn't assert pass/fail per case (the eval set exists to *measure*
the current ceiling, not enforce one yet) — read the `console.table` printed
after the run and compare `gotUids` to each case's `expected_uids`. Re-run
before/after a retrieval change to see what moved.

Not part of `npm test` / CI — see `package.json`'s `test:unit` vs
`test:integration` split.
