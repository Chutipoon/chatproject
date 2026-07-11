# CLAUDE.md — ธรรมดู (chatproject)

แชตบอตพุทธธรรม ดึงพระสูตรจริงจาก SuttaCentral → AI อธิบาย (RAG-based)
**Repo:** github.com/Chutipoon/chatproject | **Live:** chatproject-sage.vercel.app (public ✓ ยืนยัน 2026-07-02)
Deploy: Vercel team `poon-s-projects`, auto-deploy จาก main · URL เดิม project-2jbm1.vercel.app ตายแล้ว · alias `chatproject-git-main-*` ติด SSO protection

## Stack
Next.js 14 App Router + TypeScript · Vercel (free)
AI: Azure OpenAI gpt-4o-mini → Groq Llama 3.3 70B → Gemini 2.0 Flash (fallback ตาม `PROVIDER_ORDER`)
Cache/rate-limit: Upstash Redis (REST) + in-memory fallback — **ไม่มี MongoDB / ไม่มี session store ฝั่ง server** (ประวัติแชตอยู่ใน localStorage ของ browser เท่านั้น)

## Environment Variables
```
GROQ_API_KEYS=gsk_a,gsk_b        # comma-separated, round-robin (หรือ GROQ_API_KEY เดี่ยว)
GEMINI_API_KEY=AIza_xxx
AZURE_OPENAI_ENDPOINT / AZURE_OPENAI_KEY / AZURE_OPENAI_DEPLOYMENT   # optional
PROVIDER_ORDER=azure,groq,gemini # ตัวไม่มี key ถูกข้ามอัตโนมัติ
UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN   # optional — ไม่ตั้ง = in-memory
```

## Request Pipeline (POST /api/chat)
```
{ messages[], stream?, model? }
  → rate limit 20 req/min/IP (Redis INCR หรือ in-memory)
  → cache check (key = "dharma:" + lowercase 120 ตัวแรก, TTL 24h)
  → searchSutta(userMessage)  [lib/suttacentral.ts]
      1. fast-path: THAI_TO_UIDS keyword → UID ตรงๆ
      2. THAI_TO_EN keyword → English query
      3. ข้อความไทยที่เหลือ → rewriteThaiQuery (Groq llama-3.1-8b, 5s timeout) → English keywords
      4. อังกฤษล้วน → extractEnKeywords (ตัด stopword) แล้วค้น
      → GET /api/search/instant (keyword query ลองตัดคำท้ายถ้า 0 hit — search เป็น AND ทุกคำ)
      → /api/suttaplex/{uid} → /api/bilarasuttas/{uid}/sujato
      → ค้นไม่เจอ / ไม่มีเนื้อหา = คืน [] (ห้าม fallback สูตร hardcoded)
  → buildSystemPrompt(suttas)  ← ฝังเนื้อสูตรจริง หรือบอกโมเดลตรงๆ ว่าค้นไม่เจอ
  → routeToProvider (fallback เฉพาะ 429/error/missing key)
  → setCached() non-blocking
  → SSE stream (sources → token → done) หรือ JSON { reply, provider, cached, sources[] }
```

## SuttaCentral API (ยืนยันแล้ว 2026-07-02)
- **`GET /api/search/instant?query=...&language=en&limit=N` มีจริง ใช้ได้** → `{total, hits[{uid,...}]}`
- **แต่ค้นได้เฉพาะภาษาอังกฤษ** — query ภาษาไทยได้ total=0 เสมอ (นี่คือเหตุที่ต้องมี rewrite step)
- `/api/suttaplex/{uid}` = metadata/blurb · `/api/bilarasuttas/{uid}/sujato` = เนื้อสูตรจริง (ตัด 1500 ตัวอักษร)

## ข้อห้ามสำคัญ
- **ห้าม fallback เป็นพระสูตร hardcoded เมื่อค้นไม่เจอ** — คืน [] แล้วให้ buildSystemPrompt แจ้งโมเดลตรงๆ (อ้างอิงปลอมแย่กว่าไม่มีอ้างอิง)
- **ห้ามแต่ง uid พระสูตร** — ยืนยันจาก suttacentral.net (`/api/suttaplex/{uid}`) ก่อนเพิ่มใน THAI_TO_UIDS
- **THAI_TO_UIDS จับแบบ substring ตามลำดับ** — คำยาว/เจาะจงต้องอยู่ก่อนคำสั้น (อานาปานสติ ก่อน สติ)
- **ห้าม expose key ฝั่ง client** — ทุก key อยู่ใน server เท่านั้น
- ตอบภาษาเดียวกับผู้ใช้เสมอ (กำหนดใน VERIFIER_PROMPT)

## สถานะจริงของ repo (2026-07-06)
- **มี tests + CI แล้ว** — `__tests__/unit/` (jest, 20 tests) + `.github/workflows/ci.yml`, shipped ตั้งแต่ commit `7f03108`. (บันทึกเก่าที่บอกว่า "ไม่มี tests/CI" ผิดแล้ว)
- `cloudflare-worker/` ยังไม่ได้ deploy จริง (wrangler.toml เป็น placeholder) และถ้าใช้จะพัง SSE — ตัดสินใจแล้ว: ปล่อยเป็น inert ไว้เฉยๆ ไม่ลบ ไม่เปิดใช้ จนกว่าจะมีแผน deploy จริง
- **next 14.2.35 มี CVE (npm audit: 5 high/2 moderate)** ทางแก้ต้อง major upgrade เป็น next 16 (breaking). ตัดสินใจ 2026-07-06: **ยอมรับความเสี่ยงไปก่อน** — ตรวจแล้วแอปนี้ไม่ได้ใช้ `next/image`, ไม่มี `middleware.ts`, ไม่มี i18n config ซึ่งเป็น attack surface ของ CVE ส่วนใหญ่ที่พบ ความเสี่ยงจริงจึงต่ำกว่าที่ severity บอก ไว้ migrate ทีหลังเมื่อมีเวลาทำ codemod + live re-verify เต็มรูปแบบ
- Retrieval quality ceiling (`THAI_TO_UIDS`): ดูรายละเอียด/ตัวเลือกใน `docs/retrieval-quality-notes.md` — ยังไม่ตัดสินใจ ต้องมี held-out test set ก่อนเลือกทาง
