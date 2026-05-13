// lib/cache.ts
// Simple in-memory cache สำหรับ Vercel serverless
// (แต่ละ cold start จะ clear — เพียงพอสำหรับ traffic ปานกลาง)
// อัปเกรดเป็น Upstash Redis ได้ทีหลัง

interface CacheEntry {
  text: string
  provider: string
  timestamp: number
}

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 // 24 ชั่วโมง
const MAX_ENTRIES = 500

const store = new Map<string, CacheEntry>()

function makeKey(question: string): string {
  // normalize: lowercase, trim whitespace, เอาเฉพาะ 120 ตัวแรก
  return question.toLowerCase().trim().slice(0, 120)
}

export function getCached(question: string): CacheEntry | null {
  const key = makeKey(question)
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    store.delete(key)
    return null
  }
  return entry
}

export function setCached(question: string, text: string, provider: string) {
  // evict oldest if full
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) store.delete(oldest[0])
  }
  store.set(makeKey(question), { text, provider, timestamp: Date.now() })
}
