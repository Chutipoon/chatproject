// lib/providers.ts — v2
// Multi-provider router: Azure OpenAI (คุณภาพสูง, ใช้ student credit) → Groq → Gemini
// ตั้งลำดับได้ผ่าน PROVIDER_ORDER (default: azure,groq,gemini)
// ถ้าไม่ตั้ง Azure ก็ข้ามไป Groq/Gemini ฟรีตามเดิม

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

// รองรับ streaming ผ่าน callback onToken (optional)
type OnToken = (chunk: string) => void

// ---- Azure OpenAI (gpt-4o-mini) — ใช้ Azure student credit ----
async function callAzure(
  messages: ChatMessage[],
  systemPrompt: string,
  onToken?: OnToken
): Promise<string> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT       // https://xxx.openai.azure.com
  const apiKey = process.env.AZURE_OPENAI_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT    // ชื่อ deployment เช่น gpt-4o-mini
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || "2024-08-01-preview"
  if (!endpoint || !apiKey || !deployment) throw new Error("No AZURE config")

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      max_tokens: 900,
      stream: Boolean(onToken),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (res.status === 429) throw new Error("RATE_LIMIT")
  if (!res.ok) throw new Error(`Azure error ${res.status}`)
  return onToken ? readOpenAIStream(res, onToken) : extractOpenAI(await res.json())
}

// ---- Groq (Llama 3.3 70B) ----
async function callGroq(
  messages: ChatMessage[],
  systemPrompt: string,
  onToken?: OnToken
): Promise<string> {
  const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",").map((k) => k.trim()).filter(Boolean)
  if (keys.length === 0) throw new Error("No GROQ config")
  const key = keys[Math.floor(Date.now() / 60000) % keys.length] // round-robin

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 800,
      stream: Boolean(onToken),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
    signal: AbortSignal.timeout(15000),
  })
  if (res.status === 429) throw new Error("RATE_LIMIT")
  if (!res.ok) throw new Error(`Groq error ${res.status}`)
  return onToken ? readOpenAIStream(res, onToken) : extractOpenAI(await res.json())
}

// ---- Gemini Flash ----
async function callGemini(
  messages: ChatMessage[],
  systemPrompt: string,
  onToken?: OnToken
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("No GEMINI config")

  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }))
  const action = onToken ? "streamGenerateContent?alt=sse&" : "generateContent?"
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:${action}key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 800 },
      }),
      signal: AbortSignal.timeout(20000),
    }
  )
  if (res.status === 429) throw new Error("RATE_LIMIT")
  if (!res.ok) throw new Error(`Gemini error ${res.status}`)
  if (!onToken) {
    const data = await res.json()
    return data.candidates[0].content.parts[0].text
  }
  return readGeminiStream(res, onToken)
}

// ---- helpers: parse non-stream / stream ----
function extractOpenAI(data: any): string {
  return data.choices[0].message.content
}

async function readOpenAIStream(res: Response, onToken: OnToken): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = "", buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() || ""
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith("data:")) continue
      const payload = t.slice(5).trim()
      if (payload === "[DONE]") continue
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content
        if (delta) { full += delta; onToken(delta) }
      } catch { /* skip partial */ }
    }
  }
  return full
}

async function readGeminiStream(res: Response, onToken: OnToken): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let full = "", buf = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split("\n")
    buf = lines.pop() || ""
    for (const line of lines) {
      const t = line.trim()
      if (!t.startsWith("data:")) continue
      try {
        const txt = JSON.parse(t.slice(5).trim())
          .candidates?.[0]?.content?.parts?.[0]?.text
        if (txt) { full += txt; onToken(txt) }
      } catch { /* skip */ }
    }
  }
  return full
}

// ---- Main router ----
export async function routeToProvider(
  messages: ChatMessage[],
  systemPrompt: string,
  onToken?: OnToken
): Promise<{ text: string; provider: string }> {
  const order = (process.env.PROVIDER_ORDER || "azure,groq,gemini")
    .split(",").map((s) => s.trim()).filter(Boolean)

  const map: Record<string, (m: ChatMessage[], s: string, t?: OnToken) => Promise<string>> = {
    azure: callAzure, groq: callGroq, gemini: callGemini,
  }

  let lastErr: any
  for (const name of order) {
    const fn = map[name]
    if (!fn) continue
    try {
      const text = await fn(messages, systemPrompt, onToken)
      return { text, provider: name }
    } catch (err: any) {
      lastErr = err
      const skip = err.message === "RATE_LIMIT" || err.message.startsWith("No ")
      if (skip) continue
      // network/parse error ของ provider นี้ → ลองตัวถัดไปด้วย (robust กว่าเดิม)
      continue
    }
  }
  throw new Error(lastErr?.message === "RATE_LIMIT"
    ? "All providers rate-limited"
    : "All providers failed")
}
