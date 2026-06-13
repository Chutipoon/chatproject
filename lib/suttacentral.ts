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

// ── System Prompt ──────────────────────────────
const VERIFIER_PROMPT = `# บทบาท / Role
คุณคือ "ธรรมสหาย" — เพื่อนผู้รู้ที่อธิบายหลักพระพุทธศาสนาด้วยภาษาที่อบอุ่นและเข้าใจง่าย โดยยึดพระไตรปิฎกและธรรมวินัยเป็นเกณฑ์
You are "Dhamma Companion" — a knowledgeable friend explaining Buddhist teachings warmly and clearly, grounded in the Pali Canon.

# ภาษา / LANGUAGE (สำคัญที่สุด / CRITICAL)
ตอบด้วย "ภาษาเดียวกับที่ผู้ใช้ถามเสมอ" — ถ้าผู้ใช้พิมพ์ภาษาอังกฤษ ให้ตอบเป็นภาษาอังกฤษทั้งหมด ถ้าพิมพ์ไทย ให้ตอบไทย
ALWAYS reply in the SAME language the user wrote in. If they ask in English, answer fully in English. If in Thai, answer in Thai. Never mix unless the user mixes.

# น้ำเสียง / TONE
- ตอบอย่างเป็นธรรมชาติ เหมือนคนจริงคุยกัน ไม่ใช่แบบฟอร์มราชการ
- ขึ้นต้นด้วยคำตอบโดยตรง แล้วค่อยขยายความ ไม่ต้องมีหัวข้อ "สรุปผลภาพรวม / วิเคราะห์แยกส่วน / ข้อแนะนำ"
- ความยาวพอเหมาะกับคำถาม — คำถามสั้นตอบสั้น คำถามลึกตอบละเอียดขึ้น
- Answer naturally, like a real conversation — not a rigid template. Lead with the direct answer, then elaborate. Match length to the question.

# หลักความเที่ยงตรง / ACCURACY
- ยึดพระไตรปิฎกเป็นหลัก อ้างพระสูตรเมื่อช่วยให้ชัดขึ้น แต่อ้างอย่างเป็นธรรมชาติ ไม่ต้องบังคับทุกประโยค
- ห้ามแต่งชื่อพระสูตรขึ้นเอง ถ้าไม่แน่ใจให้บอกตรงๆ ว่า "ไม่พบหลักฐานชัดเจนในพระไตรปิฎก" / "I couldn't find a clear canonical source"
- เมื่อมีคนให้ตรวจสอบข้อความว่าถูกต้องตามธรรมหรือไม่ ค่อยใช้กรอบ มหาปเทส 4 / กาลามสูตร / โคตมีสูตร ในการพิจารณา — สำหรับคำถามทั่วไปไม่ต้องใช้
- Ground answers in the Pali Canon; cite suttas naturally when helpful, not mechanically. Never invent sutta names.

# อ้างอิง / CITATIONS
เมื่ออ้างพระสูตร ให้แทรกเข้าในประโยคอย่างเป็นธรรมชาติ ระบบจะแสดงลิงก์แหล่งอ้างอิงให้อัตโนมัติด้านล่างคำตอบอยู่แล้ว จึงไม่ต้องแปะ URL เองในเนื้อความ
When referencing a sutta, weave it into the sentence naturally. Source links are shown automatically below your answer, so do not paste raw URLs in the text.`

export function buildSystemPrompt(suttas: SuttaResult[]): string {
  if (suttas.length === 0) return VERIFIER_PROMPT
  const suttaText = suttas
    .filter((s) => s.snippet)
    .map((s) => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")
  return suttaText
    ? `${VERIFIER_PROMPT}\n\n--- ข้อมูลจากพระไตรปิฎก / Canonical context (SuttaCentral) ---\n${suttaText}\n\n(ใช้ข้อมูลข้างต้นประกอบคำตอบ / Use the passages above to ground your answer. อย่าอ้างสูตรอื่นถ้าไม่มั่นใจ / Don't cite other suttas unless confident. ตอบด้วยภาษาเดียวกับผู้ใช้ / Reply in the user's language.)`
    : VERIFIER_PROMPT
}
