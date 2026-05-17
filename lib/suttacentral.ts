// lib/suttacentral.ts — v3
// System prompt จาก Gemini Gems (Verifier) + SuttaCentral RAG

export interface SuttaResult {
  uid: string
  title: string
  snippet: string
  url: string
}

const THAI_TO_UIDS: Record<string, string[]> = {
  ทุกข์:         ["sn56.11", "mn141"],
  นิพพาน:       ["ud8.1", "mn26"],
  ไตรลักษณ์:    ["sn22.59", "an3.136"],
  อนิจจัง:      ["sn22.59", "sn35.1"],
  อนัตตา:       ["sn22.59", "mn35"],
  กรรม:         ["an4.232", "mn135"],
  สมาธิ:        ["dn22", "mn36"],
  ศีล:          ["dn31", "an5.179"],
  ปัญญา:        ["mn2", "sn45.8"],
  มรรค:         ["sn45.8", "dn22"],
  โพชฌงค์:      ["sn46.1", "sn46.3"],
  สติ:          ["dn22", "mn10"],
  เมตตา:        ["snp1.8", "an4.125"],
  ปฏิจจสมุปบาท: ["sn12.1", "mn38"],
  ขันธ์:        ["sn22.48", "mn109"],
  อริยสัจ:      ["sn56.11", "mn141"],
  กาลามสูตร:    ["an3.65"],
  มหาปเทส:      ["dn16"],
  โคตมีสูตร:    ["an8.53"],
  วีมังสก:      ["mn47"],
}

const FALLBACK_UIDS = ["sn56.11", "dn22", "mn10"]

function getUidsForMessage(userMessage: string): string[] {
  for (const [thai, uids] of Object.entries(THAI_TO_UIDS)) {
    if (userMessage.includes(thai)) return uids
  }
  return FALLBACK_UIDS
}

async function fetchSuttaplex(uid: string): Promise<SuttaResult | null> {
  try {
    const res = await fetch(
      `https://suttacentral.net/api/suttaplex/${uid}?language=en`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(6000) }
    )
    if (!res.ok) return null
    const data = await res.json()
    const item = Array.isArray(data) ? data[0] : data
    if (!item) return null
    return {
      uid,
      title: item.translated_title || item.original_title || item.acronym || uid,
      snippet: item.blurb || "",
      url: `https://suttacentral.net/${uid}/en/sujato`,
    }
  } catch { return null }
}

export async function searchSutta(userMessage: string): Promise<SuttaResult[]> {
  const uids = getUidsForMessage(userMessage)
  const results = await Promise.allSettled(uids.map(fetchSuttaplex))
  return results
    .filter((r): r is PromiseFulfilledResult<SuttaResult> =>
      r.status === "fulfilled" && r.value !== null)
    .map(r => r.value)
    .slice(0, 3)
}

// ── System Prompt หลัก (จาก Gemini Gems Verifier) ──────────────────
const VERIFIER_PROMPT = `# บทบาท
คุณคือ "ธรรมสหาย" ผู้เชี่ยวชาญด้านการตรวจสอบและอธิบายหลักพระพุทธศาสนา โดยยึดพระไตรปิฎกและธรรมวินัยเป็นเกณฑ์สูงสุด
ตัดสินด้วยความเที่ยงตรง ตรงไปตรงมา มุ่งชี้แจงที่ "หลักการ" ไม่โจมตีตัวบุคคล ตอบเป็นภาษาไทย สุภาพ เข้าใจง่าย

# กรอบการวิเคราะห์ (ใช้ตามความเหมาะสมของคำถาม)

**มหาปเทส 4** — ตรวจสอบความถูกต้อง
- เทียบกับพระสูตร (หลักธรรม) และพระวินัย (ข้อบังคับ)
- ถ้าขัดกัน → ปฏิเสธ | ถ้าสอดคล้อง → ยอมรับ

**กาลามสูตร** (AN 3.65) — ตรวจสอบกระบวนการคิด
- ไม่เชื่อเพราะเล่าต่อกันมา, อ้างตำรา, หรือตรรกะล้วนๆ
- ทดสอบด้วยผลจริง: เป็นกุศลหรืออกุศล?

**โคตมีสูตร** (AN 8.53) — ตรวจสอบผลลัพธ์
- ธรรมแท้มุ่งสู่: คลายกำหนัด, มักน้อย, สันโดษ, สงัด, เพียร
- ถ้าผลตรงข้าม → ไม่ใช่ธรรมวินัย

# กลไกพิเศษ
- Modern Dhamma: ถ้าไม่พบคำเฉพาะในพระสูตร ให้ประเมินที่ "เจตนา + แก่นธรรม"
- ข้อความคลุมเครือ: แสดงทั้ง 2 ด้าน (สอดคล้อง/ขัดแย้ง)
- ห้ามแต่งชื่อพระสูตรขึ้นเองโดยเด็ดขาด
- ถ้าไม่พบหลักฐาน ให้ระบุ "ไม่พบหลักฐานแน่ชัดในพระไตรปิฎก"

# รูปแบบคำตอบ
ตอบเป็น 3 ส่วนเสมอ:

**1. สรุปผลภาพรวม**
ระบุสถานะ: "สอดคล้อง" / "ขัดแย้ง" / "มีทั้งส่วนที่สอดคล้องและขัดแย้ง"

**2. วิเคราะห์แยกส่วน**
แยกทีละประโยค/ประเด็น แต่ละข้อมี:
- ข้อความ/ประเด็นที่วิเคราะห์
- ผลการพิจารณา (สอดคล้อง/ขัดแย้ง/ยังไม่ชัด)
- เหตุผลตามหลักธรรมวินัย
- อ้างอิงพระสูตร (ถ้าไม่พบให้บอกตรงๆ)

**3. ข้อแนะนำ**
- แนวทางปรับให้ถูกต้อง
- แนวทางปฏิบัติที่ตรวจสอบได้จริง
- แหล่งศึกษาต่อ (เฉพาะที่มั่นใจ)

ท้ายคำตอบระบุ: 【อ้างอิง: ชื่อสูตร】`

export function buildSystemPrompt(suttas: SuttaResult[]): string {
  if (suttas.length === 0) return VERIFIER_PROMPT

  const suttaText = suttas
    .filter(s => s.snippet)
    .map(s => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")

  return suttaText
    ? `${VERIFIER_PROMPT}\n\n--- ข้อมูลจากพระไตรปิฎก (SuttaCentral) ---\n${suttaText}`
    : VERIFIER_PROMPT
}
