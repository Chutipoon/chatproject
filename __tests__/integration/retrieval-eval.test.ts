// Live network test — hits suttacentral.net (and Groq, if GROQ_API_KEYS is set,
// for the Thai rewrite step on cases outside THAI_TO_UIDS/THAI_TO_EN). Not run in
// CI (see package.json test:unit vs test:integration, and docs/eval/README.md).
// This measures retrieval quality; it does not assert a passing bar, since the
// eval set exists precisely to find gaps in the current pipeline (see
// docs/retrieval-quality-notes.md for the known metta gap, case 13 here).
import { searchSutta } from "../../lib/suttacentral"
import evalSet from "../../docs/eval/thai-eval-set.json"

describe("Thai retrieval eval set (docs/eval/thai-eval-set.json)", () => {
  const results: { id: number; category: string; question: string; gotUids: string[] }[] = []

  it.each(evalSet as Array<{ id: number; category: string; question: string }>)(
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
