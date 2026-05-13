// lib/suttacentral.ts
// ดึงข้อความพระสูตรจริงจาก SuttaCentral API (ฟรี 100%)

export interface SuttaResult {
  uid: string        // เช่น "mn9", "sn22.59"
  title: string
  snippet: string    // ข้อความตัวอย่าง
  url: string
}

// แมปคำไทยกับ keyword บาลี/อังกฤษ
const THAI_TO_PALI: Record<string, string> = {
  ทุกข์: "dukkha suffering",
  นิพพาน: "nibbana nirvana",
  ไตรลักษณ์: "anicca dukkha anatta impermanence",
  อนิจจัง: "anicca impermanence",
  อนัตตา: "anatta not-self",
  กรรม: "kamma karma",
  สมาธิ: "samadhi meditation concentration",
  ศีล: "sila precepts virtue",
  ปัญญา: "panna wisdom insight",
  มรรค: "magga path eightfold",
  โพชฌงค์: "bojjhanga enlightenment factors",
  สติ: "sati mindfulness",
  เมตตา: "metta loving-kindness",
  ปฏิจจสมุปบาท: "paticca-samuppada dependent origination",
  ขันธ์: "khandha aggregate",
}

function buildSearchQuery(userMessage: string): string {
  // ลองจับคำสำคัญจากข้อความไทย
  for (const [thai, pali] of Object.entries(THAI_TO_PALI)) {
    if (userMessage.includes(thai)) return pali
  }
  // ถ้าหาไม่เจอ ใช้ข้อความเดิม (กรณีพิมพ์บาลีหรืออังกฤษ)
  return userMessage.slice(0, 60)
}

export async function searchSutta(userMessage: string): Promise<SuttaResult[]> {
  const query = buildSearchQuery(userMessage)

  try {
    const url = `https://suttacentral.net/api/search?query=${encodeURIComponent(query)}&lang=pli,en,th&limit=3`
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) return []

    const data = await res.json()
    const hits: SuttaResult[] = []

    for (const item of (data.hits || []).slice(0, 3)) {
      hits.push({
        uid: item.uid || "",
        title: item.translated_title || item.original_title || item.uid || "",
        snippet: item.highlight?.content?.[0] || "",
        url: `https://suttacentral.net/${item.uid}`,
      })
    }

    return hits
  } catch {
    return []
  }
}

export function buildSystemPrompt(suttas: SuttaResult[]): string {
  const base = `คุณคือ "ธรรมสหาย" ผู้ช่วยด้านพุทธธรรม ตอบเป็นภาษาไทย สุภาพ เข้าใจง่าย ความยาวไม่เกิน 200 คำ

กฎสำคัญ:
- ตอบโดยอ้างอิงข้อความพระสูตรด้านล่างเท่านั้น อย่าแต่งเนื้อหาขึ้นเอง
- ระบุแหล่งอ้างอิงท้ายคำตอบในรูปแบบ 【อ้างอิง: ชื่อสูตร】
- ถ้าข้อมูลด้านล่างไม่เพียงพอ บอกตรงๆ ว่าไม่มีข้อมูลในฐานข้อมูลนี้`

  if (suttas.length === 0) return base

  const suttaText = suttas
    .map((s) => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")

  return `${base}\n\n--- ข้อความจากพระไตรปิฎก (SuttaCentral) ---\n${suttaText}`
}
