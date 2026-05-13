// lib/providers.ts
// Multi-provider AI router — Groq → Gemini → error
// ฟรีทั้งหมด ไม่มีบัตรเครดิต

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

export interface ProviderResult {
  text: string
  provider: string
  cached: boolean
}

// ---- Groq (Llama 3.3 70B) ----
async function callGroq(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const keys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)

  if (keys.length === 0) throw new Error("No GROQ_API_KEY configured")

  // round-robin: pick key based on minute window
  const key = keys[Math.floor(Date.now() / 60000) % keys.length]

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: 800,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
    }),
    signal: AbortSignal.timeout(15000),
  })

  if (res.status === 429) throw new Error("RATE_LIMIT")
  if (!res.ok) throw new Error(`Groq error ${res.status}`)

  const data = await res.json()
  return data.choices[0].message.content
}

// ---- Gemini Flash (Google AI Studio) ----
async function callGemini(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<string> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("No GEMINI_API_KEY configured")

  // Convert to Gemini format
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }))

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
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

  const data = await res.json()
  return data.candidates[0].content.parts[0].text
}

// ---- Main router: try providers in order ----
export async function routeToProvider(
  messages: ChatMessage[],
  systemPrompt: string
): Promise<{ text: string; provider: string }> {
  const providers = [
    { name: "groq", fn: () => callGroq(messages, systemPrompt) },
    { name: "gemini", fn: () => callGemini(messages, systemPrompt) },
  ]

  for (const { name, fn } of providers) {
    try {
      const text = await fn()
      return { text, provider: name }
    } catch (err: any) {
      const isRateLimit = err.message === "RATE_LIMIT"
      const isConfig = err.message.startsWith("No ")
      // skip to next provider on rate limit or missing key
      if (isRateLimit || isConfig) continue
      throw err // real error → don't try next
    }
  }

  throw new Error("All providers rate-limited. Please try again in a moment.")
}
