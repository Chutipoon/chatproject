// lib/suttacentral.ts — v2
// ใช้ endpoint จริงของ SuttaCentral: /api/suttaplex/{uid}
// ไม่มี /api/search — เดิมเป็นสาเหตุ 404

export interface SuttaResult {
  uid: string
  title: string
  snippet: string
  url: string
}

// แมปคำไทย → uid พระสูตรที่เกี่ยวข้องโดยตรง (แม่นยำ 100%)
const THAI_TO_UIDS: Record<string, string[]> = {
  ทุกข์:            ["sn56.11", "mn141"],
  นิพพาน:          ["ud8.1", "mn26"],
  ไตรลักษณ์:       ["sn22.59", "an3.136"],
  อนิจจัง:         ["sn22.59", "sn35.1"],
  อนัตตา:          ["sn22.59", "mn35"],
  กรรม:            ["an4.232", "mn135"],
  สมาธิ:           ["dn22", "mn36"],
  ศีล:             ["dn31", "an5.179"],
  ปัญญา:           ["mn2", "sn45.8"],
  มรรค:            ["sn45.8", "dn22"],
  โพชฌงค์:         ["sn46.1", "sn46.3"],
  สติ:             ["dn22", "mn10"],
  เมตตา:           ["snp1.8", "an4.125"],
  ปฏิจจสมุปบาท:    ["sn12.1", "mn38"],
  ขันธ์:           ["sn22.48", "mn109"],
  อริยสัจ:         ["sn56.11", "mn141"],
  สังสารวัฏ:       ["sn15.1", "ud5.3"],
  โลภ:             ["an3.40", "dhp1"],
  โกรธ:            ["an3.40", "mn21"],
  หลง:             ["an3.40", "sn35.246"],
  บุญ:             ["iti22", "an8.36"],
  ทาน:             ["an8.31", "dn31"],
  ความตาย:         ["sn3.3", "mn82"],
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
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }
    )
    if (res.status === 404) return null
    if (res.status === 429) return null
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
  } catch {
    return null
  }
}

export async function searchSutta(userMessage: string): Promise<SuttaResult[]> {
  const uids = getUidsForMessage(userMessage)
  const results = await Promise.allSettled(uids.map(fetchSuttaplex))
  return results
    .filter((r): r is PromiseFulfilledResult<SuttaResult> =>
      r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value)
    .slice(0, 3)
}

export function buildSystemPrompt(suttas: SuttaResult[]): string {
  const base = `คุณคือ "ธรรมสหาย" ผู้ช่วยด้านพุทธธรรม ตอบเป็นภาษาไทย สุภาพ เข้าใจง่าย ความยาวไม่เกิน 200 คำ

กฎสำคัญ:
- อ้างอิงข้อมูลจากพระสูตรด้านล่างเสมอ ถ้ามี
- ระบุแหล่งอ้างอิงท้ายคำตอบในรูปแบบ 【อ้างอิง: ชื่อสูตร】
- ถ้าไม่มีข้อมูลพระสูตรด้านล่าง ให้อธิบายตามหลักพุทธศาสนาดั้งเดิมและระบุว่าไม่มีในฐานข้อมูล`

  if (suttas.length === 0) return base
  const suttaText = suttas
    .filter(s => s.snippet)
    .map(s => `[${s.title} — ${s.uid}]\n${s.snippet}`)
    .join("\n\n")
  return suttaText
    ? `${base}\n\n--- ข้อมูลจากพระไตรปิฎก (SuttaCentral) ---\n${suttaText}`
    : base
}
