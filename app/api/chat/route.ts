// app/api/chat/route.ts — v3
// เพิ่ม: streaming response (SSE), shared cache/rate-limit (Redis), Azure tier

import { NextRequest, NextResponse } from "next/server"
import { routeToProvider, availableProviders, ChatMessage, ProvidersUnavailable } from "@/lib/providers"
import { getCached, setCached, checkRateLimit } from "@/lib/cache"
import { searchSutta, buildSystemPrompt, groundingLevel } from "@/lib/suttacentral"

export const runtime = "nodejs"
export const maxDuration = 30

// GET → คืนรายชื่อโมเดลที่พร้อมใช้ (ให้ UI ทำ dropdown)
export async function GET() {
  return NextResponse.json({ models: availableProviders() })
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
  let messages: ChatMessage[], userMessage: string, wantStream = false, model: string | undefined
  try {
    const body = await req.json()
    messages = body.messages || []
    wantStream = body.stream !== false // default = stream
    model = typeof body.model === "string" ? body.model : undefined // โมเดลที่ผู้ใช้เลือก
    userMessage = messages.findLast((m: ChatMessage) => m.role === "user")?.content || ""
    if (!userMessage) throw new Error("empty")
  } catch {
    return NextResponse.json({ error: "รูปแบบคำขอไม่ถูกต้อง กรุณาลองใหม่" }, { status: 400 })
  }

  // cache (shared)
  const cached = await getCached(userMessage)
  if (cached) {
    const cachedSources = cached.sources || []
    return NextResponse.json({
      reply: cached.text, provider: cached.provider, cached: true, sources: cachedSources,
      grounding: cachedSources.length > 0 ? "grounded" : "ungrounded",
    })
  }

  // RAG (ล้มเหลวได้ ไม่หยุด pipeline)
  let suttas: Awaited<ReturnType<typeof searchSutta>> = []
  try { suttas = await searchSutta(userMessage) } catch { suttas = [] }
  const systemPrompt = buildSystemPrompt(suttas, userMessage)
  const sources = suttas.map((s) => ({ title: s.title, url: s.url, uid: s.uid }))
  const grounding = groundingLevel(suttas)

  // ---- non-stream path ----
  if (!wantStream) {
    try {
      const { text, provider } = await routeToProvider(messages, systemPrompt, undefined, model)
      await setCached(userMessage, text, provider, sources)
      return NextResponse.json({ reply: text, provider, cached: false, sources, grounding })
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
      send({ type: "sources", sources, grounding })
      try {
        const { text, provider } = await routeToProvider(
          messages, systemPrompt,
          (chunk) => send({ type: "token", text: chunk }),
          model
        )
        await setCached(userMessage, text, provider, sources)
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
  if (err instanceof ProvidersUnavailable) {
    const active = err.failures.filter(f => f.kind !== "configuration")
    if (!active.length) return "ยังไม่ได้ตั้งค่าผู้ให้บริการ AI กรุณาติดต่อผู้ดูแลระบบ"
    if (active.some(f => f.kind === "rate_limit")) return "โควตา AI เต็มหรือส่งคำขอถี่เกินไป กรุณาลองใหม่ภายหลัง"
    if (active.some(f => f.kind === "authentication")) return "การเชื่อมต่อ AI ไม่ผ่านการยืนยันสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ"
    if (active.some(f => f.kind === "model")) return "โมเดล AI ที่ตั้งค่าไว้ไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
    if (active.some(f => f.kind === "timeout")) return "AI ตอบกลับไม่ทันเวลา กรุณาลองใหม่อีกครั้ง"
    return "ผู้ให้บริการ AI ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่ภายหลัง"
  }
  const m = err?.message || ""
  if (m.includes("rate-limited")) return "ระบบรับคำถามมากเกินไปในขณะนี้ กรุณารอ 1 นาทีแล้วลองใหม่"
  if (m === "RATE_LIMIT") return "AI กำลังถูกใช้งานหนัก กรุณารอสักครู่"
  return "เกิดข้อผิดพลาดภายใน กรุณาลองใหม่อีกครั้ง"
}
