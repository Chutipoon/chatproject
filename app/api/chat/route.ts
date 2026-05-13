// app/api/chat/route.ts
// Next.js 14 App Router API route
// Pipeline: rate-limit → cache → SuttaCentral → AI provider

import { NextRequest, NextResponse } from "next/server"
import { routeToProvider, ChatMessage } from "@/lib/providers"
import { getCached, setCached } from "@/lib/cache"
import { searchSutta, buildSystemPrompt } from "@/lib/suttacentral"

// ---- Simple in-process rate limiter (per IP) ----
const ipWindows = new Map<string, { count: number; reset: number }>()
const RATE_LIMIT = 20       // requests per window
const WINDOW_MS = 60_000    // 1 นาที

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = ipWindows.get(ip)

  if (!entry || now > entry.reset) {
    ipWindows.set(ip, { count: 1, reset: now + WINDOW_MS })
    return true // allowed
  }

  if (entry.count >= RATE_LIMIT) return false // blocked

  entry.count++
  return true
}

// ---- Route handler ----
export async function POST(req: NextRequest) {
  // 1. Rate limit by IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"

  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "คุณส่งคำถามบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429 }
    )
  }

  // 2. Parse body
  let messages: ChatMessage[], userMessage: string
  try {
    const body = await req.json()
    messages = body.messages || []
    userMessage = messages.findLast((m: ChatMessage) => m.role === "user")?.content || ""
    if (!userMessage) throw new Error("empty")
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  // 3. Check cache (cache คำถามล่าสุดของ conversation นี้)
  const cached = getCached(userMessage)
  if (cached) {
    return NextResponse.json({
      reply: cached.text,
      provider: cached.provider,
      cached: true,
      sources: [],
    })
  }

  // 4. Search SuttaCentral for real sutta text
  const suttas = await searchSutta(userMessage)

  // 5. Build system prompt with real sutta content
  const systemPrompt = buildSystemPrompt(suttas)

  // 6. Call AI provider (Groq → Gemini fallback)
  try {
    const { text, provider } = await routeToProvider(messages, systemPrompt)

    // 7. Cache the result
    setCached(userMessage, text, provider)

    return NextResponse.json({
      reply: text,
      provider,
      cached: false,
      sources: suttas.map((s) => ({ title: s.title, url: s.url, uid: s.uid })),
    })
  } catch (err: any) {
    const msg = err.message?.includes("All providers")
      ? "ระบบรับคำถามมากเกินไปในขณะนี้ กรุณารอ 1 นาทีแล้วลองใหม่"
      : "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง"
    return NextResponse.json({ error: msg }, { status: 503 })
  }
}
