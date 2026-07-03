import { parseRewriteOutput, buildSystemPrompt, SuttaResult } from "../../lib/suttacentral"

describe("parseRewriteOutput", () => {
  it("lowercases and trims a plain keyword answer", () => {
    expect(parseRewriteOutput("Mindfulness")).toBe("mindfulness")
  })

  it("strips surrounding quotes and punctuation", () => {
    expect(parseRewriteOutput('"loving kindness."')).toBe("loving kindness")
  })

  it("returns null for the NONE sentinel, case-insensitively", () => {
    expect(parseRewriteOutput("NONE")).toBeNull()
    expect(parseRewriteOutput("none")).toBeNull()
  })

  it("returns null for empty or whitespace-only input", () => {
    expect(parseRewriteOutput("")).toBeNull()
    expect(parseRewriteOutput("   ")).toBeNull()
  })

  it("rejects output that isn't plain English keywords (e.g. a full sentence with punctuation)", () => {
    expect(parseRewriteOutput("I think the answer is: suffering!")).toBeNull()
  })

  it("rejects non-Latin script output (model replying in Thai)", () => {
    expect(parseRewriteOutput("ทุกข์")).toBeNull()
  })

  it("rejects single-character or too-short output", () => {
    expect(parseRewriteOutput("a")).toBeNull()
  })

  it("accepts multi-word hyphenated keywords", () => {
    expect(parseRewriteOutput("loving-kindness metta")).toBe("loving-kindness metta")
  })
})

describe("buildSystemPrompt", () => {
  it("includes a retrieval-failure note and no fabricated citation when given no suttas", () => {
    const prompt = buildSystemPrompt([])
    expect(prompt).toContain("Retrieval note")
    expect(prompt).not.toContain("Canonical context")
  })

  it("omits suttas with no snippet text and only cites ones that have content", () => {
    const suttas: SuttaResult[] = [
      { uid: "mn10", title: "Satipatthana Sutta", snippet: "The four foundations...", url: "x" },
      { uid: "sn1.1", title: "Empty Sutta", snippet: "", url: "y" },
    ]
    const prompt = buildSystemPrompt(suttas)
    expect(prompt).toContain("mn10")
    expect(prompt).toContain("The four foundations")
    expect(prompt).not.toContain("sn1.1")
  })

  it("falls back to the no-source note when every sutta has an empty snippet", () => {
    const suttas: SuttaResult[] = [{ uid: "mn10", title: "x", snippet: "", url: "y" }]
    const prompt = buildSystemPrompt(suttas)
    expect(prompt).toContain("Retrieval note")
  })
})
