// app/api/chat/route.ts — v3
// เพิ่ม: streaming response (SSE), shared cache/rate-limit (Redis), Azure tier

import { NextRequest, NextResponse } from "next/server"
import { routeToProvider, ChatMessage } from "@/lib/providers"
import { getCached, setCached, checkRateLimit } from "@/lib/cache"
import { searchSutta, buildSystemPrompt } from "@/lib/suttacentral"

export const runtime = "nodejs"
export const maxDuration = 30

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405 })
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") || "unknown"

  if (!(await checkRateLimit(ip))) {
    return NextResponse.json(
      { error: "คุณส่งคำถามบ่อยเกินไป กรุณารอ 1 นาทีแล้วลองใหม่" },
      { status: 429 }
    )
  }

  // parse
  let messages: ChatMessage[], userMessage: string, wantStream = false
  try {
    const body = await req.json()
    messages = body.messages || []
    wantStream = body.stream !== false // default = stream
    userMessage = messages.findLast((m: ChatMessage) => m.role === "user")?.content || ""
    if (!userMessage) throw new Error("empty")
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง กรุณาลองใหม่" }, { status: 400 })
  }

  // cache (shared)
  const cached = await getCached(userMessage)
  if (cached) {
    return NextResponse.json({
      reply: cached.text, provider: cached.provider, cached: true, sources: [],
    })
  }

  // RAG (ล้มเหลวได้ ไม่หยุด pipeline)
  let suttas: Awaited<ReturnType<typeof searchSutta>> = []
  try { suttas = await searchSutta(userMessage) } catch { suttas = [] }
  const systemPrompt = buildSystemPrompt(suttas)
  const sources = suttas.map((s) => ({ title: s.title, url: s.url, uid: s.uid }))

  // ---- non-stream path ----
  if (!wantStream) {
    try {
      const { text, provider } = await routeToProvider(messages, systemPrompt)
      await setCached(userMessage, text, provider)
      return NextResponse.json({ reply: text, provider, cached: false, sources })
    } catch (err: any) {
      return NextResponse.json({ error: errMsg(err) }, { status: 503 })
    }
  }

  // ---- streaming path (SSE) ----
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      // ส่ง sources ก่อน เพื่อให้ frontend แสดงอ้างอิงได้เลย
      send({ type: "sources", sources })
      try {
        const { text, provider } = await routeToProvider(
          messages, systemPrompt,
          (chunk) => send({ type: "token", text: chunk })
        )
        await setCached(userMessage, text, provider)
        send({ type: "done", provider })
      } catch (err: any) {
        send({ type: "error", error: errMsg(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

function errMsg(err: any): string {
  const m = err?.message || ""
  if (m.includes("rate-limited")) return "ระบบรับคำถามมากเกินไปในขณะนี้ กรุณารอ 1 นาทีแล้วลองใหม่"
  if (m === "RATE_LIMIT") return "AI กำลังถูกใช้งานหนัก กรุณารอสักครู่"
  return "เกิดข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง"
}
