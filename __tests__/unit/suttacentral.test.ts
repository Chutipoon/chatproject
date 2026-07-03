import { parseRewriteOutput, buildSystemPrompt, fastPathUids, SuttaResult } from "../../lib/suttacentral"

describe("fastPathUids", () => {
  it("does not hijack unrelated questions that merely mention Buddhism generically", () => {
    // regression: "พุทธศาสนา"/"ธรรมะ"/"พระพุทธเจ้า" used to fast-path ANY question
    // containing them to an unrelated hardcoded sutta (e.g. a meat-eating question
    // was routed to sn56.11, the Four Noble Truths) instead of actually searching.
    expect(fastPathUids("การกินเนื้อสัตว์ผิดหลักพระพุทธศาสนาไหม")).toBeNull()
    expect(fastPathUids("ธรรมะเรื่องการทำงานเป็นอย่างไร")).toBeNull()
    expect(fastPathUids("พระพุทธเจ้าตรัสเรื่องการเมืองไว้อย่างไร")).toBeNull()
  })

  it("still matches specific, genuinely topical keywords", () => {
    expect(fastPathUids("ทุกข์คืออะไร")).toEqual(["sn56.11", "mn141"])
    expect(fastPathUids("อานาปานสติทำอย่างไร")).toEqual(["mn118"])
  })
})

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
