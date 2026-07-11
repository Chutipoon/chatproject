// Live network test — hits suttacentral.net (and Groq, if GROQ_API_KEYS is set,
// for the Thai rewrite step on cases outside THAI_TO_UIDS/THAI_TO_EN). Not run in
// CI (see package.json test:unit vs test:integration, and docs/eval/README.md).
// This measures retrieval quality; it does not assert a passing bar, since the
// eval set exists precisely to find gaps in the current pipeline (see
// docs/retrieval-quality-notes.md for the known metta gap, case 13 here).
import { searchSutta, buildSystemPrompt, groundingLevel } from "../../lib/suttacentral"
import { routeToProvider, availableProviders } from "../../lib/providers"
import evalSet from "../../docs/eval/thai-eval-set.json"

type EvalCase = { id: number; category: string; question: string; forbidden?: string[] }

describe("Thai retrieval eval set (docs/eval/thai-eval-set.json)", () => {
  const results: { id: number; category: string; question: string; gotUids: string[] }[] = []

  it.each(evalSet as EvalCase[])(
    "case $id [$category]: $question",
    async ({ id, category, question }) => {
      const suttas = await searchSutta(question)
      const gotUids = suttas.map((s) => s.uid)
      results.push({ id, category, question, gotUids })
      // No hard assertion here — see file header. Failures in this project are
      // measured by comparing docs/eval/thai-eval-set.json's expected_uids to
      // the printed summary table below, not by red/green test status.
      expect(Array.isArray(gotUids)).toBe(true)
    },
    20000
  )

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.table(results.map((r) => ({ ...r, gotUids: r.gotUids.join(", ") || "(none)" })))
  })
})

// Content-check pass: runs the exact same searchSutta → buildSystemPrompt →
// routeToProvider path app/api/chat/route.ts uses, and inspects the real LLM
// answer — the retrieval-only block above cannot catch a case like #21, where
// retrieval correctly returns nothing but the model fabricates content in the
// no-grounding prompt branch. Only cases that declare a `forbidden` list are
// exercised here; each entry is a substring the answer must never contain
// (e.g. an invented sutta name observed in a real past failure). This is a
// tripwire for known fabrications, not a general content-quality judge.
const forbiddenCases = (evalSet as EvalCase[]).filter((c) => c.forbidden && c.forbidden.length > 0)
const hasProvider = availableProviders().length > 0

;(hasProvider ? describe : describe.skip)(
  "Thai eval set — LLM answer content (forbidden-string tripwires)",
  () => {
    if (!hasProvider) {
      // eslint-disable-next-line no-console
      console.warn(
        "Skipping LLM content-check cases: no provider configured " +
          "(AZURE_OPENAI_*/GROQ_API_KEY(S)/GEMINI_API_KEY). These cases are " +
          "NOT verified in this run — set a provider key to actually cover them."
      )
    }

    it.each(forbiddenCases)(
      "case $id [$category]: answer must not contain a forbidden string",
      async ({ question, forbidden }) => {
        const suttas = await searchSutta(question)
        // these cases exist precisely because retrieval finds nothing for them —
        // assert that stays true, since the forbidden-string check below only
        // makes sense against the no-grounding prompt branch.
        expect(groundingLevel(suttas)).toBe("ungrounded")
        const systemPrompt = buildSystemPrompt(suttas, question)
        const { text } = await routeToProvider([{ role: "user", content: question }], systemPrompt)
        for (const bad of forbidden!) {
          expect(text).not.toContain(bad)
        }
      },
      30000
    )
  }
)
