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
// NOTE: จับแบบ substring ตามลำดับใน object — คำที่ยาว/เจาะจงกว่าต้องอยู่ก่อนคำสั้น
// (เช่น อานาปานสติ ต้องมาก่อน สติ, อโหสิกรรม ต้องมาก่อน กรรม)
const THAI_TO_UIDS: Record<string, string[]> = {
  อานาปานสติ: ["mn118"], อโหสิกรรม: ["mn21", "sn7.2"],
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
  ความตาย: ["an6.19", "an6.20"], เศร้า: ["snp3.8", "sn47.13"],
  เสียใจ: ["snp3.8", "sn47.13"], เสียชีวิต: ["snp3.8", "sn47.13"],
  ความโกรธ: ["sn7.2", "an5.161"],
  เวียนว่ายตายเกิด: ["sn15.3"], ให้ทาน: ["an5.34", "an7.52"],
  ทำบุญ: ["an8.36"], พระพุทธเจ้า: ["mn26", "dn16"],
  พุทธศาสนา: ["sn56.11"], ธรรมะ: ["sn56.11", "dn31"],
}

// แปลคำไทยยอดนิยม → อังกฤษ สำหรับ full-text search
const THAI_TO_EN: Record<string, string> = {
  ทุกข์: "suffering dukkha", นิพพาน: "nibbana", กรรม: "kamma action",
  สมาธิ: "concentration meditation", ศีล: "virtue ethics", ปัญญา: "wisdom",
  สติ: "mindfulness", เมตตา: "loving-kindness metta", ความตาย: "death",
  ความโกรธ: "anger", ความกลัว: "fear",
  ความรัก: "love affection", สวดมนต์: "chanting recitation paritta",
  ศรัทธา: "faith saddha", นรก: "hell niraya", สวรรค์: "heaven deva rebirth",
  อิจฉา: "envy jealousy", สันโดษ: "contentment", วิปัสสนา: "insight vipassana",
  ความเพียร: "effort energy viriya", ความสุข: "happiness sukha",
  โลภ: "greed craving", บวช: "ordination going forth",
  ครอบครัว: "family householder duties",
}

const SC_BASE = "https://suttacentral.net"
const TIMEOUT = 6000

function fastPathUids(msg: string): string[] | null {
  for (const [thai, uids] of Object.entries(THAI_TO_UIDS)) {
    if (msg.includes(thai)) return uids
  }
  return null
}

// ── Thai → English query rewrite (LLM) ─────────
// /api/search/instant ค้นได้เฉพาะภาษาอังกฤษ (query ไทยได้ 0 hit เสมอ)
// คำถามไทยที่ไม่อยู่ในตาราง keyword จึงต้องแปลงเป็น keyword อังกฤษก่อน
const REWRITE_SYSTEM =
  "Convert the user's Thai question about Buddhism into 1-3 English search keywords " +
  "for searching Pali Canon suttas on SuttaCentral, most important keyword first " +
  "(the search requires ALL words to match, so fewer words = better recall). " +
  "Output ONLY the keywords, lowercase, separated by single spaces, no punctuation, " +
  "no explanation. If the question has no searchable Buddhist topic, output exactly: NONE"

// exported เพื่อให้ unit test ได้ (pure function)
export function parseRewriteOutput(raw: string): string | null {
  const t = raw.trim().replace(/^["'`]+|["'`.]+$/g, "").trim()
  if (!t || /^none$/i.test(t)) return null
  // รับเฉพาะ keyword อังกฤษล้วน — กันโมเดลตอบเป็นประโยค/ภาษาอื่น
  if (!/^[a-zA-Z][a-zA-Z\s-]{2,60}$/.test(t)) return null
  return t.toLowerCase()
}

async function rewriteThaiQuery(msg: string): Promise<string | null> {
  const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",").map((k) => k.trim()).filter(Boolean)
  if (keys.length === 0) return null // ไม่มี key → ข้ามขั้นนี้ ไม่พัง
  const key = keys[Math.floor(Date.now() / 60000) % keys.length] // round-robin
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        max_tokens: 30,
        temperature: 0,
        messages: [
          { role: "system", content: REWRITE_SYSTEM },
          { role: "user", content: msg.slice(0, 500) },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return parseRewriteOutput(data?.choices?.[0]?.message?.content || "")
  } catch { return null }
}

async function searchOnce(query: string): Promise<string[]> {
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

// full-text search → UID list (query ต้องเป็นอังกฤษแล้ว)
// search เป็น AND ทุกคำ — คำเยอะ = 0 hit ง่าย ดังนั้น query จาก keyword
// (shorten=true) ให้ลองตัดคำท้ายทิ้งทีละขั้น แต่คำถามอังกฤษดิบห้ามตัด
// (เดี๋ยวเหลือแต่ stopword เช่น "What is" แล้วได้ผลมั่ว)
async function searchUids(query: string, shorten = false): Promise<string[]> {
  const words = query.trim().split(/\s+/)
  const attempts = [query]
  if (shorten && words.length > 2) attempts.push(words.slice(0, 2).join(" "))
  if (shorten && words.length > 1) attempts.push(words[0])
  for (const q of attempts) {
    const uids = await searchOnce(q)
    if (uids.length > 0) return uids
  }
  return []
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

const THAI_RE = /[฀-๿]/ // อักษรไทย

// คำถามอังกฤษเต็มประโยคค้นตรงๆ แทบไม่เจอ (search เป็น AND) → คัดเฉพาะคำเนื้อหา
const EN_STOPWORDS = new Set((
  "what is are was were the a an of to in on at about and or do does did " +
  "how why when where who whom which i me my you your we us our it its " +
  "can could should would will shall may might must please tell explain " +
  "mean meaning meant say said says there this that these those be being been"
).split(" "))

function extractEnKeywords(msg: string): string {
  return msg.toLowerCase().replace(/[^a-z\s-]/g, " ").split(/\s+/)
    .filter((w) => w && !EN_STOPWORDS.has(w)).slice(0, 4).join(" ")
}

export async function searchSutta(userMessage: string): Promise<SuttaResult[]> {
  let uids = fastPathUids(userMessage)
  if (!uids) {
    // หา query อังกฤษ: ตารางแปลก่อน (ฟรี) → LLM rewrite (เฉพาะข้อความไทย)
    let query: string | null = null
    let fromKeywords = true // query เป็น keyword ล้วน → ตัดคำท้ายได้ถ้า 0 hit
    for (const [thai, en] of Object.entries(THAI_TO_EN)) {
      if (userMessage.includes(thai)) { query = en; break }
    }
    if (!query) {
      if (THAI_RE.test(userMessage)) {
        query = await rewriteThaiQuery(userMessage)
      } else {
        query = extractEnKeywords(userMessage)
        if (!query) { query = userMessage; fromKeywords = false } // เหลือแต่ stopword → ค้นทั้งประโยค
      }
    }
    uids = query ? await searchUids(query, fromKeywords) : []
  }
  // ค้นไม่เจอ = คืน [] ตรงๆ — ห้าม fallback เป็นสูตร hardcoded (จะกลายเป็นอ้างอิงปลอม)
  if (uids.length === 0) return []

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
  // ตัดผลที่ไม่มีเนื้อหาเลย (ไม่มีทั้ง blurb และ segment เช่นสูตรที่ไม่มีคำแปล sujato)
  // ไม่งั้น UI จะโชว์ source chip ทั้งที่ prompt ไม่มีเนื้อสูตรให้อ้าง
  return results.filter((r) => r.snippet)
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
  const suttaText = suttas
    .filter((s) => s.snippet)
    .map((s) => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")
  if (!suttaText) {
    // ค้นไม่พบสูตรที่ตรงคำถาม — บอกโมเดลตรงๆ ห้ามให้มันเดาอ้างอิงเอง
    return `${VERIFIER_PROMPT}\n\n--- หมายเหตุการค้นหา / Retrieval note ---\nรอบนี้ระบบค้นไม่พบพระสูตรที่ตรงกับคำถามโดยเฉพาะ ให้ตอบจากความรู้ทั่วไปเกี่ยวกับพระพุทธศาสนา ถ้าคำตอบควรมีแหล่งอ้างอิง ให้บอกผู้ใช้ตรงๆ ว่าครั้งนี้ไม่สามารถอ้างพระสูตรเฉพาะเจาะจงได้ ห้ามระบุชื่อหรือเลขพระสูตรที่ไม่แน่ใจเด็ดขาด\nNo specific sutta was retrieved for this question. Answer from general Buddhist knowledge; if a citation would normally be expected, tell the user plainly that you cannot cite a specific sutta this time. Never state a sutta name or number you are not certain of.`
  }
  return `${VERIFIER_PROMPT}\n\n--- ข้อมูลจากพระไตรปิฎก / Canonical context (SuttaCentral) ---\n${suttaText}\n\n(ใช้ข้อมูลข้างต้นประกอบคำตอบ / Use the passages above to ground your answer. อย่าอ้างสูตรอื่นถ้าไม่มั่นใจ / Don't cite other suttas unless confident. ตอบด้วยภาษาเดียวกับผู้ใช้ / Reply in the user's language.)`
}
