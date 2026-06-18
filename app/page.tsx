"use client"
// app/page.tsx — ธรรมสหาย frontend
// Aesthetic: warm parchment, saffron gold, Thai temple-inspired

import { useState, useRef, useEffect, useCallback } from "react"

/* ── types ─────────────────────────────────────────────── */
interface Source { uid: string; title: string; url: string }
interface Message {
  id: number
  role: "user" | "bot"
  text: string
  provider?: string
  cached?: boolean
  sources?: Source[]
  loading?: boolean
}
interface Conversation {
  id: string
  title: string
  messages: Message[]
  updatedAt: number
}

const STORAGE_KEY = "dharma-chats-v1"
const INTRO_TEXT =
  "สวัสดีครับ ผมคือ ธรรมสหาย ผู้ช่วยด้านพุทธธรรมดิจิทัล\n\nท่านสามารถถามเรื่องธรรมะ ศีล สมาธิ ปัญญา หรือการนำหลักพุทธศาสนาไปใช้ในชีวิต ผมจะตอบโดยอ้างอิงพระไตรปิฎกและแหล่งที่มาจริงทุกครั้ง"

const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const introMessage = (): Message => ({ id: uid(), role: "bot", text: INTRO_TEXT })
const newConversation = (): Conversation => ({
  id: newId(), title: "แชตใหม่", messages: [introMessage()], updatedAt: Date.now(),
})

// ตั้งชื่อห้องจากคำถามแรกของผู้ใช้ (ตัดให้สั้น)
function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, " ")
  return t.length <= 28 ? t : t.slice(0, 28) + "…"
}

const SUGGESTIONS = [
  "ทุกข์คืออะไร และเราพ้นทุกข์ได้อย่างไร",
  "วิธีเริ่มต้นนั่งสมาธิสำหรับมือใหม่",
  "ไตรลักษณ์ อนิจจัง ทุกขัง อนัตตา คืออะไร",
  "มรรค 8 ประการ มีอะไรบ้าง",
  "กรรมดีกรรมชั่วทำงานอย่างไร",
  "เมตตาภาวนา คือการปฏิบัติแบบไหน",
]

let idCounter = 0
const uid = () => ++idCounter

/* ── WheelIcon SVG ─────────────────────────────────────── */
function WheelIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="2.5" />
      {[0,45,90,135,180,225,270,315].map((deg, i) => {
        const r = (deg * Math.PI) / 180
        const x1 = 12 + 2.5 * Math.cos(r), y1 = 12 + 2.5 * Math.sin(r)
        const x2 = 12 + 9.5 * Math.cos(r), y2 = 12 + 9.5 * Math.sin(r)
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />
      })}
    </svg>
  )
}

/* ── TypingDots ─────────────────────────────────────────── */
function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "var(--gold)",
          display: "inline-block",
          animation: `bounce 1.1s ${i * 0.2}s infinite ease-in-out`,
        }} />
      ))}
    </span>
  )
}

/* ── SourceChip ─────────────────────────────────────────── */
function SourceChip({ source }: { source: Source }) {
  return (
    <a href={source.url} target="_blank" rel="noopener noreferrer"
      style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        fontSize: 11, padding: "3px 9px", borderRadius: 99,
        border: "1px solid var(--gold-light)",
        color: "var(--amber)", textDecoration: "none",
        background: "rgba(200,148,58,0.08)",
        transition: "all 0.15s",
        lineHeight: 1.4,
      }}
      onMouseEnter={e => {
        const el = e.currentTarget
        el.style.background = "rgba(200,148,58,0.18)"
        el.style.borderColor = "var(--gold)"
      }}
      onMouseLeave={e => {
        const el = e.currentTarget
        el.style.background = "rgba(200,148,58,0.08)"
        el.style.borderColor = "var(--gold-light)"
      }}
    >
      <span>📜</span>
      <span>{source.title || source.uid}</span>
    </a>
  )
}

/* ── MessageBubble ──────────────────────────────────────── */
function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user"

  // parse 【อ้างอิง:…】 out of bot text
  let mainText = msg.text
  let inlineRef = ""
  if (!isUser) {
    const m = msg.text.match(/【อ้างอิง:([^】]+)】/)
    if (m) { mainText = msg.text.replace(m[0], "").trim(); inlineRef = m[1].trim() }
  }

  return (
    <div style={{
      display: "flex",
      flexDirection: isUser ? "row-reverse" : "row",
      alignItems: "flex-start",
      gap: 10,
      animation: "slideIn 0.22s ease both",
    }}>
      {/* avatar */}
      <div style={{
        width: 34, height: 34, borderRadius: "50%", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 16,
        background: isUser ? "var(--parchment)" : "linear-gradient(135deg,#D4791A,#C8943A)",
        color: isUser ? "var(--bark-mid)" : "#fff",
        boxShadow: "0 2px 8px var(--shadow)",
        border: isUser ? "1px solid var(--gold-light)" : "none",
      }}>
        {isUser ? "🙏" : <WheelIcon size={17} />}
      </div>

      {/* bubble */}
      <div style={{ maxWidth: "76%", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{
          padding: "11px 16px",
          borderRadius: isUser ? "18px 4px 18px 18px" : "4px 18px 18px 18px",
          background: isUser
            ? "var(--bark)"
            : "white",
          color: isUser ? "#F5EFE0" : "var(--ink)",
          fontSize: 14,
          lineHeight: 1.7,
          boxShadow: "0 2px 12px var(--shadow)",
          border: isUser ? "none" : "1px solid rgba(200,148,58,0.2)",
          fontFamily: "'Sarabun', sans-serif",
          fontWeight: 300,
        }}>
          {msg.loading ? <TypingDots /> : mainText}
        </div>

        {/* inline citation */}
        {inlineRef && (
          <div style={{
            fontSize: 11.5, color: "var(--amber)",
            padding: "4px 10px",
            background: "rgba(200,148,58,0.07)",
            borderRadius: 8,
            borderLeft: "2.5px solid var(--gold)",
            fontStyle: "italic",
          }}>
            อ้างอิง: {inlineRef}
          </div>
        )}

        {/* source chips */}
        {msg.sources && msg.sources.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {msg.sources.map(s => <SourceChip key={s.uid} source={s} />)}
          </div>
        )}

        {/* provider badge */}
        {msg.provider && !isUser && (
          <div style={{ fontSize: 10.5, color: "var(--gold-light)", paddingLeft: 4 }}>
            {msg.cached ? "⚡ cache" : `via ${msg.provider}`}
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Decorative top lotus strip ─────────────────────────── */
function LotusStrip() {
  return (
    <div aria-hidden style={{
      position: "absolute", top: 0, left: 0, right: 0, height: 3,
      background: "linear-gradient(90deg,transparent,var(--gold),var(--saffron),var(--gold),transparent)",
    }} />
  )
}

/* ── MAIN PAGE ──────────────────────────────────────────── */
export default function DharmaChat() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState<string>("")
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(true)
  const [models, setModels] = useState<{ id: string; label: string }[]>([])
  const [selectedModel, setSelectedModel] = useState<string>("")
  const [hydrated, setHydrated] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // โหลดประวัติแชตจาก localStorage (ครั้งแรก)
  useEffect(() => {
    let loaded: Conversation[] = []
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) loaded = JSON.parse(raw)
    } catch { loaded = [] }
    if (!Array.isArray(loaded) || loaded.length === 0) loaded = [newConversation()]
    setConversations(loaded)
    setActiveId(loaded[0].id)
    setHydrated(true)
  }, [])

  // บันทึกทุกครั้งที่แชตเปลี่ยน
  useEffect(() => {
    if (!hydrated) return
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations)) } catch {}
  }, [conversations, hydrated])

  // โหลดรายชื่อโมเดลที่พร้อมใช้ (จาก backend)
  useEffect(() => {
    fetch("/api/chat")
      .then(r => r.json())
      .then(d => {
        const list = d.models || []
        setModels(list)
        if (list.length > 0) setSelectedModel(list[0].id)
      })
      .catch(() => {})
  }, [])

  const active = conversations.find(c => c.id === activeId)
  const messages = active?.messages ?? []

  // อัปเดต messages ของห้องที่เปิดอยู่ (แทน setMessages เดิม)
  const setMessages = useCallback((updater: (prev: Message[]) => Message[]) => {
    setConversations(prev => prev.map(c =>
      c.id === activeId ? { ...c, messages: updater(c.messages), updatedAt: Date.now() } : c
    ))
  }, [activeId])

  const createChat = useCallback(() => {
    const c = newConversation()
    setConversations(prev => [c, ...prev])
    setActiveId(c.id)
    setShowSuggestions(true)
    setInput("")
  }, [])

  const selectChat = useCallback((id: string) => {
    setActiveId(id)
    setShowSuggestions(false)
  }, [])

  const deleteChat = useCallback((id: string) => {
    setConversations(prev => {
      const rest = prev.filter(c => c.id !== id)
      const next = rest.length > 0 ? rest : [newConversation()]
      // ถ้าลบห้องที่เปิดอยู่ → เด้งไปห้องแรก
      setActiveId(cur => (cur === id ? next[0].id : cur))
      return next
    })
  }, [])

  const scrollBottom = useCallback(() => {
    setTimeout(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }), 50)
  }, [])

  useEffect(() => { scrollBottom() }, [messages, scrollBottom])

  const send = useCallback(async (text: string) => {
    const q = text.trim()
    if (!q || loading) return
    setInput("")
    setShowSuggestions(false)
    if (textareaRef.current) { textareaRef.current.style.height = "44px" }

    const userMsg: Message = { id: uid(), role: "user", text: q }
    const loadMsg: Message = { id: uid(), role: "bot", text: "", loading: true }

    setMessages(prev => [...prev, userMsg, loadMsg])

    // ตั้งชื่อห้องจากคำถามแรก (ถ้ายังเป็น "แชตใหม่")
    setConversations(prev => prev.map(c => {
      if (c.id !== activeId) return c
      const onlyIntro = c.messages.filter(m => m.role === "user").length === 0
      return onlyIntro ? { ...c, title: titleFrom(q) } : c
    }))

    // build conversation history (exclude loading)
    const history = [...messages, userMsg]
      .filter(m => !m.loading)
      .map(m => ({ role: m.role === "bot" ? "assistant" : "user", content: m.text }))

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history, stream: true, model: selectedModel || undefined }),
      })

      // cache hit หรือ error → ตอบเป็น JSON ธรรมดา (ไม่ stream)
      const ct = res.headers.get("content-type") || ""
      if (!ct.includes("text/event-stream")) {
        const data = await res.json()
        setMessages(prev => prev.map(m =>
          m.id === loadMsg.id
            ? { ...m, loading: false, text: data.reply || data.error || "เกิดข้อผิดพลาด", provider: data.provider, cached: data.cached, sources: data.sources || [] }
            : m
        ))
        return
      }

      // ---- consume SSE stream ----
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let acc = "", buf = "", srcs: Source[] = [], prov: string | undefined

      const apply = (patch: Partial<Message>) =>
        setMessages(prev => prev.map(m => m.id === loadMsg.id ? { ...m, ...patch } : m))

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() || ""
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          let evt: any
          try { evt = JSON.parse(t.slice(5).trim()) } catch { continue }
          if (evt.type === "sources") { srcs = evt.sources || []; apply({ sources: srcs }) }
          else if (evt.type === "token") { acc += evt.text; apply({ loading: false, text: acc, sources: srcs }) }
          else if (evt.type === "done") { prov = evt.provider; apply({ loading: false, text: acc, provider: prov, sources: srcs }) }
          else if (evt.type === "error") { apply({ loading: false, text: evt.error || "เกิดข้อผิดพลาด" }) }
        }
      }
    } catch {
      setMessages(prev => prev.map(m =>
        m.id === loadMsg.id
          ? { ...m, loading: false, text: "ขออภัยครับ เกิดข้อผิดพลาดในการเชื่อมต่อ กรุณาลองใหม่อีกครั้ง" }
          : m
      ))
    } finally {
      setLoading(false)
    }
  }, [loading, messages, activeId, selectedModel, setMessages])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = "44px"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <>
      {/* global keyframe injection */}
      <style>{`
        @keyframes slideIn { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
        @keyframes bounce { 0%,60%,100% { transform:translateY(0) } 30% { transform:translateY(-5px) } }
        @keyframes spin { to { transform:rotate(360deg) } }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
      `}</style>

      {/* ── layout shell ── */}
      <div style={{
        display: "flex", height: "100dvh", overflow: "hidden",
        fontFamily: "'Sarabun', sans-serif",
      }}>

        {/* ── sidebar ── */}
        <aside style={{
          width: 260, flexShrink: 0,
          background: "var(--bark)",
          display: "flex", flexDirection: "column",
          padding: "0",
          borderRight: "1px solid var(--bark-mid)",
        }}>
          <LotusStrip />

          {/* brand */}
          <div style={{ padding: "28px 20px 20px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 42, height: 42, borderRadius: "50%",
                background: "linear-gradient(135deg,var(--saffron),var(--gold))",
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 20px rgba(212,121,26,0.4)",
                color: "#fff", flexShrink: 0,
              }}>
                <WheelIcon size={22} />
              </div>
              <div>
                <div style={{
                  fontFamily: "'Noto Serif Thai', serif",
                  fontSize: 16, fontWeight: 600,
                  color: "var(--cream)",
                  letterSpacing: "0.02em",
                  lineHeight: 1.2,
                } as React.CSSProperties}>ธรรมสหาย</div>
                <div style={{ fontSize: 11, color: "var(--gold-light)", marginTop: 1 }}>
                  ผู้ช่วยด้านพุทธธรรม
                </div>
              </div>
            </div>
          </div>

          {/* แชตใหม่ */}
          <div style={{ padding: "16px 16px 8px" }}>
            <button onClick={createChat}
              style={{
                width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                background: "linear-gradient(135deg,var(--saffron),var(--gold))",
                border: "none", color: "#fff",
                fontSize: 13.5, fontWeight: 500, fontFamily: "'Sarabun', sans-serif",
                padding: "10px 14px", borderRadius: 10, cursor: "pointer",
                boxShadow: "0 2px 10px rgba(212,121,26,0.3)",
                transition: "filter 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.07)" }}
              onMouseLeave={e => { e.currentTarget.style.filter = "none" }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> แชตใหม่
            </button>
          </div>

          {/* รายการแชต */}
          <div style={{ padding: "8px 12px", flex: 1, overflowY: "auto" }}>
            <div style={{ fontSize: 10.5, color: "var(--gold-light)", letterSpacing: "0.1em", textTransform: "uppercase", margin: "8px 8px 8px" }}>
              ประวัติการสนทนา
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {[...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map(c => {
                const isActive = c.id === activeId
                return (
                  <div key={c.id}
                    onClick={() => selectChat(c.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      background: isActive ? "rgba(200,148,58,0.18)" : "transparent",
                      borderRadius: 8, padding: "8px 10px", cursor: "pointer",
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = "rgba(200,148,58,0.08)" }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = "transparent" }}
                  >
                    <span style={{ fontSize: 13, flexShrink: 0, opacity: 0.7 }}>☸</span>
                    <span style={{
                      flex: 1, fontSize: 12.5, lineHeight: 1.4,
                      color: isActive ? "var(--cream)" : "rgba(245,239,224,0.65)",
                      fontFamily: "'Sarabun', sans-serif",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                    }}>{c.title}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteChat(c.id) }}
                      aria-label="ลบแชต"
                      style={{
                        background: "transparent", border: "none", cursor: "pointer",
                        color: "rgba(245,239,224,0.4)", fontSize: 14, lineHeight: 1,
                        padding: "2px 4px", borderRadius: 4, flexShrink: 0,
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--saffron)" }}
                      onMouseLeave={e => { e.currentTarget.style.color = "rgba(245,239,224,0.4)" }}
                    >×</button>
                  </div>
                )
              })}
            </div>
          </div>

          {/* footer */}
          <div style={{ marginTop: "auto", padding: "16px 20px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 10.5, color: "rgba(245,239,224,0.35)", lineHeight: 1.6 }}>
              อ้างอิงพระไตรปิฎก<br />
              ฉบับมหาจุฬาลงกรณราชวิทยาลัย<br />
              + SuttaCentral.net
            </div>
          </div>
        </aside>

        {/* ── main chat area ── */}
        <main style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "var(--mist)", overflow: "hidden",
          position: "relative",
        }}>

          {/* subtle background pattern */}
          <div aria-hidden style={{
            position: "absolute", inset: 0, pointerEvents: "none",
            backgroundImage: `radial-gradient(circle at 20% 20%, rgba(200,148,58,0.04) 0%, transparent 60%),
                              radial-gradient(circle at 80% 80%, rgba(212,121,26,0.03) 0%, transparent 60%)`,
          }} />

          {/* header */}
          <header style={{
            padding: "14px 24px",
            borderBottom: "1px solid rgba(200,148,58,0.15)",
            display: "flex", alignItems: "center", gap: 12,
            background: "rgba(249,244,234,0.8)",
            backdropFilter: "blur(8px)",
            position: "relative", zIndex: 1,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%",
              background: "var(--saffron)",
              boxShadow: "0 0 8px var(--saffron)",
            }} />
            <span style={{
              fontFamily: "'Noto Serif Thai', serif",
              fontSize: 14.5, color: "var(--bark)",
              fontWeight: 500,
            }}>
              ธรรมสหาย
            </span>
            <span style={{ fontSize: 12, color: "var(--gold)", marginLeft: 4 }}>
              — อ้างอิงพระไตรปิฎกจริง
            </span>

            {/* เลือกโมเดล / model picker */}
            {models.length > 0 && (
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ fontSize: 11, color: "var(--gold)" }}>โมเดล</span>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  aria-label="เลือกโมเดล AI"
                  style={{
                    fontSize: 12, fontFamily: "inherit", color: "var(--bark)",
                    background: "rgba(255,255,255,0.7)",
                    border: "1px solid rgba(200,148,58,0.35)",
                    borderRadius: 8, padding: "5px 10px", cursor: "pointer", outline: "none",
                  }}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
          </header>

          {/* chat messages */}
          <div ref={chatRef} style={{
            flex: 1, overflowY: "auto",
            padding: "24px 28px",
            display: "flex", flexDirection: "column", gap: 18,
            position: "relative", zIndex: 1,
          }}>
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
          </div>

          {/* quick suggestions (first load) */}
          {showSuggestions && messages.length <= 1 && (
            <div style={{
              padding: "0 28px 12px",
              display: "flex", gap: 8, flexWrap: "wrap",
              animation: "fadeIn 0.4s ease",
              position: "relative", zIndex: 1,
            }}>
              {SUGGESTIONS.slice(0, 3).map((s, i) => (
                <button key={i} onClick={() => send(s)}
                  style={{
                    fontSize: 12.5, padding: "6px 14px", borderRadius: 99,
                    border: "1px solid var(--gold-light)",
                    background: "transparent", color: "var(--amber)",
                    cursor: "pointer", fontFamily: "'Sarabun', sans-serif",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={e => {
                    const el = e.currentTarget
                    el.style.background = "var(--gold-light)"
                    el.style.color = "var(--bark)"
                  }}
                  onMouseLeave={e => {
                    const el = e.currentTarget
                    el.style.background = "transparent"
                    el.style.color = "var(--amber)"
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* input area */}
          <div style={{
            padding: "12px 24px 20px",
            borderTop: "1px solid rgba(200,148,58,0.15)",
            background: "rgba(249,244,234,0.9)",
            backdropFilter: "blur(8px)",
            position: "relative", zIndex: 1,
          }}>
            <div style={{
              display: "flex", gap: 10, alignItems: "flex-end",
              background: "white",
              borderRadius: 16,
              border: "1.5px solid rgba(200,148,58,0.25)",
              padding: "6px 6px 6px 16px",
              boxShadow: "0 2px 16px var(--shadow)",
              transition: "border-color 0.2s",
            }}
              onFocusCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "var(--gold)" }}
              onBlurCapture={e => { (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(200,148,58,0.25)" }}
            >
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => { setInput(e.target.value); autoResize(e.target) }}
                onKeyDown={handleKey}
                placeholder="ถามเรื่องธรรมะ การปฏิบัติ หรือการใช้ชีวิตตามหลักพุทธ…"
                rows={1}
                style={{
                  flex: 1, resize: "none", border: "none", outline: "none",
                  fontSize: 14, fontFamily: "'Sarabun', sans-serif", fontWeight: 300,
                  color: "var(--ink)", background: "transparent",
                  lineHeight: 1.6, height: 44, maxHeight: 120,
                  padding: "8px 0",
                }}
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                style={{
                  width: 44, height: 44, borderRadius: 12, border: "none",
                  background: loading || !input.trim()
                    ? "var(--parchment)"
                    : "linear-gradient(135deg,var(--saffron),var(--gold))",
                  color: loading || !input.trim() ? "var(--gold-light)" : "white",
                  cursor: loading || !input.trim() ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, flexShrink: 0,
                  transition: "all 0.2s",
                  boxShadow: loading || !input.trim() ? "none" : "0 2px 10px rgba(212,121,26,0.35)",
                }}
              >
                {loading
                  ? <span style={{ fontSize: 16, animation: "spin 1s linear infinite", display: "block" }}>☸</span>
                  : "↑"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--gold)", textAlign: "center", marginTop: 8 }}>
              กด Enter เพื่อส่ง · Shift+Enter ขึ้นบรรทัดใหม่
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
