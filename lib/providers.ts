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

type FailureKind = "configuration" | "authentication" | "rate_limit" | "model" | "upstream" | "timeout" | "network" | "empty"
export class ProviderFailure extends Error {
  constructor(public kind: FailureKind, public status?: number) { super(kind) }
}
export class ProvidersUnavailable extends Error {
  constructor(public failures: { provider: string; kind: FailureKind; status?: number }[]) {
    super("Providers unavailable")
  }
}
function checkResponse(res: Response): void {
  if (res.ok) return
  const kind = res.status === 429 ? "rate_limit" : [401, 403].includes(res.status)
    ? "authentication" : [400, 404, 410].includes(res.status) ? "model" : "upstream"
  throw new ProviderFailure(kind, res.status)
}
const geminiModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash-lite"
const groqModel = () => process.env.GROQ_MODEL || "llama-3.3-70b-versatile"

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
  checkResponse(res)
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
      model: groqModel(),
      max_tokens: 800,
      temperature: 0.3, // ลด random sampling กัน mojibake ในสคริปต์ทรัพยากรน้อย (เช่นไทย) ที่ Llama 3 เป็นบ้าง
      stream: Boolean(onToken),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
    signal: AbortSignal.timeout(15000),
  })
  checkResponse(res)
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
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel())}:${action}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 800 },
      }),
      signal: AbortSignal.timeout(20000),
    }
  )
  checkResponse(res)
  if (!onToken) {
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error("Empty response (no candidates/content)")
    return sanitizeText(text)
  }
  return readGeminiStream(res, onToken)
}

// ---- helpers: parse non-stream / stream ----

// Llama 3 (Groq) บางครั้งหลุดอักษรผิดสคริปต์ (จีน/เกาหลี/อาหรับ/เวียดนาม ฯลฯ) ปนกลาง
// ประโยคไทย — bug ของ tokenizer โมเดล ไม่ใช่การ decode ผิดของเรา (ยืนยันแล้วจาก non-stream
// path ที่ใช้ res.json() ตรงๆ ไม่มี manual byte decode). ลด temperature ช่วยได้บางส่วน
// (ยังพบ ~25-36% ของคำตอบ) จึงกรองอักษรนอกไทย/ละตินพื้นฐาน/เครื่องหมายวรรคตอนทั่วไป/
// สระพยัญชนะบาลีที่ใช้จริงทิ้งไปตรงๆ เป็นด่านสุดท้าย — exported เพื่อ unit test
const PALI_DIACRITICS = "āĀīĪūŪñÑṅṄṭṬḍḌṇṆḷḶṃṂ"
const SANITIZE_RE = new RegExp(`[^\\u0000-\\u007E\\u0E00-\\u0E7F\\u00A0\\u2010-\\u2027${PALI_DIACRITICS}]`, "g")

export function sanitizeText(s: string): string {
  return s.replace(SANITIZE_RE, "")
}

function extractOpenAI(data: any): string {
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error("Empty response (no choices/content)")
  return sanitizeText(content)
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
        if (delta) { const clean = sanitizeText(delta); if (clean) { full += clean; onToken(clean) } }
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
        if (txt) { const clean = sanitizeText(txt); if (clean) { full += clean; onToken(clean) } }
      } catch { /* skip */ }
    }
  }
  return full
}

// ---- Main router ----
export async function routeToProvider(
  messages: ChatMessage[],
  systemPrompt: string,
  onToken?: OnToken,
  preferred?: string
): Promise<{ text: string; provider: string }> {
  const baseOrder = (process.env.PROVIDER_ORDER || "azure,groq,gemini")
    .split(",").map((s) => s.trim()).filter(Boolean)

  // ถ้าผู้ใช้เลือกโมเดล → ลองตัวนั้นก่อน แล้วค่อย fallback ตามลำดับเดิม
  const order = preferred && baseOrder.includes(preferred)
    ? [preferred, ...baseOrder.filter((p) => p !== preferred)]
    : baseOrder

  const map: Record<string, (m: ChatMessage[], s: string, t?: OnToken) => Promise<string>> = {
    azure: callAzure, groq: callGroq, gemini: callGemini,
  }

  const failures: { provider: string; kind: FailureKind; status?: number }[] = []
  for (const name of order) {
    const fn = map[name]
    if (!fn) continue
    let emitted = false
    try {
      const text = await fn(messages, systemPrompt, onToken ? (chunk) => { emitted = true; onToken(chunk) } : undefined)
      if (!text.trim()) throw new ProviderFailure("empty")
      return { text, provider: name }
    } catch (err: any) {
      const kind: FailureKind = err instanceof ProviderFailure ? err.kind
        : err.message?.startsWith("No ") ? "configuration"
        : ["TimeoutError", "AbortError"].includes(err.name) ? "timeout" : "network"
      const failure = { provider: name, kind, status: err instanceof ProviderFailure ? err.status : undefined }
      failures.push(failure)
      // Never log keys, request URLs, prompts or upstream response bodies.
      console.error("AI_PROVIDER_FAILURE", failure)
      if (emitted) throw new ProvidersUnavailable(failures)
    }
  }
  throw new ProvidersUnavailable(failures)
}

// รายชื่อโมเดลที่ "ตั้งค่าพร้อมใช้" (มี key) — ส่งให้ UI ทำ dropdown
export function availableProviders(): { id: string; label: string }[] {
  const labels: Record<string, string> = {
    azure: "Azure GPT-4o-mini",
    groq: `Groq ${groqModel()}`,
    gemini: `Gemini ${geminiModel()}`,
  }
  const configured: Record<string, boolean> = {
    azure: Boolean(process.env.AZURE_OPENAI_ENDPOINT && process.env.AZURE_OPENAI_KEY && process.env.AZURE_OPENAI_DEPLOYMENT),
    groq: Boolean(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  }
  const order = (process.env.PROVIDER_ORDER || "azure,groq,gemini")
    .split(",").map((s) => s.trim()).filter(Boolean)
  return order.filter((id) => configured[id]).map((id) => ({ id, label: labels[id] || id }))
}
