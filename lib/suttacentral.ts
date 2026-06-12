// lib/suttacentral.ts — v4
// RAG จริง: full-text search → ดึงเนื้อสูตรจริง (ไม่ใช่แค่ blurb)
// คงตาราง keyword ไว้เป็น fast-path สำหรับคำถามยอดนิยม (cache hit สูง)

export interface SuttaResult {
  uid: string
  title: string
  snippet: string
  url: string
}

// fast-path: คำถามยอดนิยม map ตรงไป UID (เร็ว ไม่ต้อง search)
const THAI_TO_UIDS: Record<string, string[]> = {
  ทุกข์: ["sn56.11", "mn141"], นิพพาน: ["ud8.1", "mn26"],
  ไตรลักษณ์: ["sn22.59", "an3.136"], อนิจจัง: ["sn22.59", "sn35.1"],
  อนัตตา: ["sn22.59", "mn35"], กรรม: ["an4.232", "mn135"],
  สมาธิ: ["dn22", "mn36"], ศีล: ["dn31", "an5.179"],
  ปัญญา: ["mn2", "sn45.8"], มรรค: ["sn45.8", "dn22"],
  โพชฌงค์: ["sn46.1", "sn46.3"], สติ: ["dn22", "mn10"],
  เมตตา: ["snp1.8", "an4.125"], ปฏิจจสมุปบาท: ["sn12.1", "mn38"],
  ขันธ์: ["sn22.48", "mn109"], อริยสัจ: ["sn56.11", "mn141"],
  กาลามสูตร: ["an3.65"], มหาปเทส: ["dn16"],
  โคตมีสูตร: ["an8.53"], วีมังสก: ["mn47"],
}

// แปลคำไทยยอดนิยม → อังกฤษ สำหรับ full-text search
const THAI_TO_EN: Record<string, string> = {
  ทุกข์: "suffering dukkha", นิพพาน: "nibbana", กรรม: "kamma action",
  สมาธิ: "concentration meditation", ศีล: "virtue ethics", ปัญญา: "wisdom",
  สติ: "mindfulness", เมตตา: "loving-kindness metta", ความตาย: "death",
  ความโกรธ: "anger", ความกลัว: "fear", ใจ: "mind",
}

const SC_BASE = "https://suttacentral.net"
const TIMEOUT = 6000

function fastPathUids(msg: string): string[] | null {
  for (const [thai, uids] of Object.entries(THAI_TO_UIDS)) {
    if (msg.includes(thai)) return uids
  }
  return null
}

// full-text search → UID list (เมื่อไม่อยู่ fast-path)
async function searchUids(msg: string): Promise<string[]> {
  // แปลงคำไทยที่รู้จัก → en เพื่อ recall ดีขึ้น
  let query = msg
  for (const [thai, en] of Object.entries(THAI_TO_EN)) {
    if (msg.includes(thai)) { query = en; break }
  }
  try {
    const res = await fetch(
      `${SC_BASE}/api/search/instant?query=${encodeURIComponent(query)}&language=en&limit=5`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) }
    )
    if (!res.ok) return []
    const data = await res.json()
    const hits = data?.hits || data?.results || []
    return hits
      .map((h: any) => h.uid || h.acronym || h?.sutta?.uid)
      .filter(Boolean)
      .slice(0, 3)
  } catch {
    return []
  }
}

// ดึง metadata (title + blurb) จาก suttaplex
async function fetchMeta(uid: string): Promise<SuttaResult | null> {
  try {
    const res = await fetch(`${SC_BASE}/api/suttaplex/${uid}?language=en`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return null
    const data = await res.json()
    const item = Array.isArray(data) ? data[0] : data
    if (!item) return null
    return {
      uid,
      title: item.translated_title || item.original_title || item.acronym || uid,
      snippet: item.blurb || "",
      url: `${SC_BASE}/${uid}/en/sujato`,
    }
  } catch { return null }
}

// ดึงเนื้อสูตรจริง (segment text) — สิ่งที่ v3 ขาด
async function fetchSegments(uid: string): Promise<string> {
  try {
    const res = await fetch(`${SC_BASE}/api/bilarasuttas/${uid}/sujato?lang=en`, {
      headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT),
    })
    if (!res.ok) return ""
    const data = await res.json()
    const segs = data?.translation_text || data?.segmented?.translation_text || {}
    const text = Object.values(segs).filter((v) => typeof v === "string").join(" ")
    // จำกัดความยาวกัน prompt บวม (เก็บ ~1500 ตัวอักษรแรกที่มีสาระ)
    return (text as string).replace(/\s+/g, " ").trim().slice(0, 1500)
  } catch { return "" }
}

export async function searchSutta(userMessage: string): Promise<SuttaResult[]> {
  let uids = fastPathUids(userMessage)
  if (!uids) uids = await searchUids(userMessage)
  if (uids.length === 0) uids = ["sn56.11", "dn22", "mn10"] // fallback

  const metas = await Promise.allSettled(uids.slice(0, 3).map(fetchMeta))
  const results: SuttaResult[] = metas
    .filter((r): r is PromiseFulfilledResult<SuttaResult> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value)

  // เสริมเนื้อสูตรจริงเข้า snippet (ขนานกัน)
  await Promise.allSettled(
    results.map(async (r) => {
      const seg = await fetchSegments(r.uid)
      if (seg) r.snippet = seg // เนื้อจริงดีกว่า blurb
    })
  )
  return results
}

// ── System Prompt (Verifier) ──────────────────────────────
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
    .filter((s) => s.snippet)
    .map((s) => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")
  return suttaText
    ? `${VERIFIER_PROMPT}\n\n--- ข้อมูลจากพระไตรปิฎก (SuttaCentral) ---\n${suttaText}\n\n(ใช้ข้อมูลข้างต้นประกอบ ห้ามอ้างสูตรนอกเหนือจากนี้ถ้าไม่มั่นใจ)`
    : VERIFIER_PROMPT
}
