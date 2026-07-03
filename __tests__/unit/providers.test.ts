import { sanitizeText } from "../../lib/providers"

describe("sanitizeText", () => {
  it("passes Thai text through unchanged", () => {
    expect(sanitizeText("การกินเนื้อสัตว์ไม่ถือว่าเป็นการละเมิดศีล")).toBe(
      "การกินเนื้อสัตว์ไม่ถือว่าเป็นการละเมิดศีล"
    )
  })

  it("passes plain English text through unchanged", () => {
    expect(sanitizeText("The Jivaka Sutta explains this clearly.")).toBe(
      "The Jivaka Sutta explains this clearly."
    )
  })

  it("strips stray CJK characters mid-sentence", () => {
    expect(sanitizeText("ไม่ควรฆ่า杀สัตว์")).toBe("ไม่ควรฆ่าสัตว์")
  })

  it("strips stray Cyrillic and Korean characters", () => {
    expect(sanitizeText("จлівคสูตร")).toBe("จคสูตร")
    expect(sanitizeText("ศีลห้า만다ข้อ")).toBe("ศีลห้าข้อ")
  })

  it("strips Vietnamese-diacritic Latin characters not used in Pali romanization", () => {
    expect(sanitizeText("การให้ทานệที่ถูกต้อง")).toBe("การให้ทานที่ถูกต้อง")
  })

  it("keeps genuine Pali/IAST diacritics used in sutta titles", () => {
    expect(sanitizeText("Advice to Sigālaka (Sīgālovāda Sutta)")).toBe(
      "Advice to Sigālaka (Sīgālovāda Sutta)"
    )
  })

  it("keeps common smart-quote and dash punctuation", () => {
    expect(sanitizeText("this is “quoted” — and correct")).toBe("this is “quoted” — and correct")
  })
})
