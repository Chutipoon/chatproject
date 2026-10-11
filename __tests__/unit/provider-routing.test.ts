import { routeToProvider, ProvidersUnavailable } from "../../lib/providers"

describe("provider failure handling", () => {
  const env = { ...process.env }
  const originalFetch = global.fetch
  beforeEach(() => {
    process.env = { ...env, PROVIDER_ORDER: "groq,gemini", GROQ_API_KEY: "test-groq", GEMINI_API_KEY: "test-gemini" }
    delete process.env.GROQ_API_KEYS
    jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => { process.env = env; global.fetch = originalFetch; jest.restoreAllMocks() })
  const messages = [{ role: "user" as const, content: "เมตตา" }]

  it("uses a configurable current Gemini model and passes its key in a header", async () => {
    process.env.PROVIDER_ORDER = "gemini"
    process.env.GEMINI_MODEL = "configured-model"
    const fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "เมตตา" }] } }] })))
    global.fetch = fetchMock
    expect(await routeToProvider(messages, "context")).toEqual({ text: "เมตตา", provider: "gemini" })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toContain("models/configured-model:generateContent?")
    expect(url).not.toContain("test-gemini")
    expect(options.headers["x-goog-api-key"]).toBe("test-gemini")
  })

  it("retains safe status details for all failed providers without logging secrets", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(new Response("secret body", { status: 401 }))
      .mockResolvedValueOnce(new Response("secret body", { status: 404 }))
    try { await routeToProvider(messages, "private prompt"); throw new Error("expected failure") }
    catch (err) {
      expect(err).toBeInstanceOf(ProvidersUnavailable)
      expect((err as ProvidersUnavailable).failures).toEqual([
        { provider: "groq", kind: "authentication", status: 401 },
        { provider: "gemini", kind: "model", status: 404 },
      ])
    }
    expect(JSON.stringify((console.error as jest.Mock).mock.calls)).not.toMatch(/test-groq|test-gemini|secret body|private prompt/)
  })

  it("falls back when a stream returns no text", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(new Response("data: [DONE]\n\n"))
      .mockResolvedValueOnce(new Response('data: {"candidates":[{"content":{"parts":[{"text":"คำตอบ"}]}}]}\n\n'))
    const token = jest.fn()
    expect(await routeToProvider(messages, "context", token)).toEqual({ text: "คำตอบ", provider: "gemini" })
    expect(token).toHaveBeenCalledWith("คำตอบ")
  })

  it("does not mix providers after a partial stream fails", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"บางส่วน"}}]}\n\n'))
    }, pull(controller) { controller.error(new Error("connection lost")) } })
    const fetchMock = jest.fn().mockResolvedValue(new Response(stream))
    global.fetch = fetchMock
    await expect(routeToProvider(messages, "context", jest.fn())).rejects.toBeInstanceOf(ProvidersUnavailable)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
