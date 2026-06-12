// lib/cache.ts — v2
// Cache แบบ Upstash Redis (REST) + fallback เป็น in-memory
// แก้ปัญหา: Vercel serverless แต่ละ instance แยก Map กัน → cache hit ต่ำ
// Redis = shared ทุก instance → cache จริง + rate-limit จริง

interface CacheEntry {
  text: string
  provider: string
  timestamp: number
}

const CACHE_TTL_S = 60 * 60 * 24 // 24 ชม.
const MAX_ENTRIES = 500

// ---- in-memory fallback (ใช้เมื่อไม่ตั้ง Upstash) ----
const store = new Map<string, CacheEntry>()

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const useRedis = Boolean(REDIS_URL && REDIS_TOKEN)

function makeKey(question: string): string {
  return "dharma:" + question.toLowerCase().trim().slice(0, 120)
}

// REST call เดียว ใช้ได้ทั้ง get/set/incr
async function redis(cmd: (string | number)[]): Promise<any> {
  const res = await fetch(REDIS_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`Redis ${res.status}`)
  const data = await res.json()
  return data.result
}

export async function getCached(question: string): Promise<CacheEntry | null> {
  const key = makeKey(question)
  if (useRedis) {
    try {
      const raw = await redis(["GET", key])
      return raw ? (JSON.parse(raw) as CacheEntry) : null
    } catch {
      return null // Redis ล่ม → ไม่ crash แค่ข้าม cache
    }
  }
  // in-memory
  const entry = store.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL_S * 1000) {
    store.delete(key)
    return null
  }
  return entry
}

export async function setCached(question: string, text: string, provider: string): Promise<void> {
  const key = makeKey(question)
  const entry: CacheEntry = { text, provider, timestamp: Date.now() }
  if (useRedis) {
    try {
      await redis(["SET", key, JSON.stringify(entry), "EX", CACHE_TTL_S])
    } catch { /* ไม่ crash */ }
    return
  }
  if (store.size >= MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) store.delete(oldest[0])
  }
  store.set(key, entry)
}

// ---- Rate limiter แบบ shared (Redis INCR + EXPIRE) ----
const RATE_LIMIT = 20
const WINDOW_S = 60
const ipWindows = new Map<string, { count: number; reset: number }>()

export async function checkRateLimit(ip: string): Promise<boolean> {
  if (useRedis) {
    try {
      const key = `rl:${ip}`
      const count = (await redis(["INCR", key])) as number
      if (count === 1) await redis(["EXPIRE", key, WINDOW_S])
      return count <= RATE_LIMIT
    } catch {
      return true // Redis ล่ม → ปล่อยผ่าน ดีกว่า block ผู้ใช้
    }
  }
  // in-memory fallback
  const now = Date.now()
  const entry = ipWindows.get(ip)
  if (!entry || now > entry.reset) {
    ipWindows.set(ip, { count: 1, reset: now + WINDOW_S * 1000 })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}
