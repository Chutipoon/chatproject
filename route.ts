// app/api/chat/route.ts — v2
// เพิ่ม: Method Guard, Robust error handling, ข้อความ error ภาษาไทยชัดเจน

import { NextRequest, NextResponse } from "next/server"
import { routeToProvider, ChatMessage } from "@/lib/providers"
import { getCached, setCached } from "@/lib/cache"
import { searchSutta, buildSystemPrompt } from "@/lib/suttacentral"

// ---- rate limiter ----
const ipWindows = new Map<string, { count: number; reset: number }>()
const RATE_LIMIT = 20
const WINDOW_MS = 60_000

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipWindows.get(ip)
  if (!entry || now > entry.reset) {
    ipWindows.set(ip, { count: 1, reset: now + WINDOW_MS })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// ---- 1. Method Guard: ป้องกัน GET / OPTIONS / etc. ----
export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 })
}

export async function POST(req: NextRequest) {
  // 2. Rate limit
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "คุณส่งคำถามบ่อยเกินไป กรุณารอ 1 นาทีแล้วลองใหม่" },
      { status: 429 }
    )
  }

  // 3. Parse body
  let messages: ChatMessage[], userMessage: string
  try {
    const body = await req.json()
    messages = body.messages || []
    userMessage = messages.findLast((m: ChatMessage) => m.role === "user")?.content || ""
    if (!userMessage) throw new Error("empty")
  } catch {
    return NextResponse.json(
      { error: "รูปแบบคำขอไม่ถูกต้อง กรุณาลองใหม่" },
      { status: 400 }
    )
  }

  // 4. Cache check
  const cached = getCached(userMessage)
  if (cached) {
    return NextResponse.json({
      reply: cached.text,
      provider: cached.provider,
      cached: true,
      sources: [],
    })
  }

  // 5. SuttaCentral — ล้มเหลวได้ ไม่หยุด pipeline
  let suttas: Awaited<ReturnType<typeof searchSutta>> = []
  try {
    suttas = await searchSutta(userMessage)
  } catch {
    // SuttaCentral ล่ม → ใช้ base prompt แทน ไม่ crash
    suttas = []
  }

  // 6. Build system prompt
  const systemPrompt = buildSystemPrompt(suttas)

  // 7. AI provider (Groq → Gemini fallback อยู่ใน routeToProvider แล้ว)
  try {
    const { text, provider } = await routeToProvider(messages, systemPrompt)
    setCached(userMessage, text, provider)
    return NextResponse.json({
      reply: text,
      provider,
      cached: false,
      sources: suttas.map(s => ({ title: s.title, url: s.url, uid: s.uid })),
    })
  } catch (err: any) {
    // จำแนก error ให้ผู้ใช้เข้าใจ
    const msg = err.message?.includes("All providers")
      ? "ระบบรับคำถามมากเกินไปในขณะนี้ กรุณารอ 1 นาทีแล้วลองใหม่"
      : err.message?.includes("RATE_LIMIT")
      ? "AI กำลังถูกใช้งานหนัก กรุณารอสักครู่"
      : "เกิดข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง"

    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
