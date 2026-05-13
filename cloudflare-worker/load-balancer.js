// cloudflare-worker/load-balancer.js
// Deploy ที่ Cloudflare Workers (ฟรี 100,000 req/วัน)
// ทำหน้าที่กระจาย traffic ไปยัง Vercel backends หลายอัน
// หรือเป็น edge cache ชั้นแรกก่อนถึง Vercel

export default {
  async fetch(request, env) {
    // CORS headers สำหรับ browser
    const corsHeaders = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }

    // ---- Edge rate limit (per IP, ใน Cloudflare Workers) ----
    const ip = request.headers.get("CF-Connecting-IP") || "unknown"
    const rateLimitKey = `rl:${ip}`
    const count = parseInt((await env.KV?.get(rateLimitKey)) || "0")

    if (count >= 30) {
      return new Response(
        JSON.stringify({ error: "คุณส่งคำถามบ่อยเกินไป กรุณารอสักครู่" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // increment counter (TTL 60 วินาที)
    await env.KV?.put(rateLimitKey, String(count + 1), { expirationTtl: 60 })

    // ---- Edge cache ชั้นแรก ----
    const body = await request.text()
    let userMessage = ""
    try {
      const parsed = JSON.parse(body)
      const msgs = parsed.messages || []
      userMessage = msgs.findLast((m) => m.role === "user")?.content || ""
    } catch {}

    if (userMessage) {
      const cacheKey = `cache:${userMessage.toLowerCase().trim().slice(0, 100)}`
      const cached = await env.KV?.get(cacheKey)
      if (cached) {
        return new Response(cached, {
          headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "HIT" },
        })
      }
    }

    // ---- Forward ไปยัง Vercel backend ----
    // รองรับ backends หลายอัน เลือกแบบ round-robin
    const backends = (env.BACKEND_URLS || "").split(",").map((u) => u.trim()).filter(Boolean)
    if (backends.length === 0) {
      return new Response(JSON.stringify({ error: "No backends configured" }), {
        status: 503, headers: corsHeaders,
      })
    }

    const backend = backends[Math.floor(Date.now() / 1000) % backends.length]

    try {
      const upstream = await fetch(`${backend}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": ip },
        body,
        signal: AbortSignal.timeout(30000),
      })

      const responseText = await upstream.text()

      // cache คำตอบที่สำเร็จ 24 ชั่วโมง
      if (upstream.ok && userMessage && env.KV) {
        const cacheKey = `cache:${userMessage.toLowerCase().trim().slice(0, 100)}`
        await env.KV.put(cacheKey, responseText, { expirationTtl: 86400 })
      }

      return new Response(responseText, {
        status: upstream.status,
        headers: { ...corsHeaders, "Content-Type": "application/json", "X-Cache": "MISS" },
      })
    } catch (err) {
      return new Response(
        JSON.stringify({ error: "เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }
  },
}
