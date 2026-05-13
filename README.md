# ธรรมสหาย — ระดับ 3: Multi-provider Setup

## สถาปัตยกรรม

```
ผู้ใช้ → Cloudflare Worker (edge cache + rate limit ฟรี 100k req/วัน)
           ↓
        Vercel (Next.js backend)
           ↓
        SuttaCentral API → ดึงพระสูตรจริง (ฟรี)
           ↓
        Groq (Llama 3.3 70B) ← ลองก่อน
           ↓ ถ้า 429
        Gemini Flash ← fallback
```

## ขั้นตอน Deploy

### 1. ได้รับ API Keys (ฟรีทั้งหมด)

**Groq** (แนะนำสมัครหลาย account)
- ไปที่ https://console.groq.com
- Sign up ด้วย Google (ใช้ email ต่างกันสำหรับแต่ละ account)
- Dashboard → API Keys → Create API Key
- คัดลอกเก็บไว้

**Gemini Flash**
- ไปที่ https://aistudio.google.com
- Get API Key → Create API Key in new project
- คัดลอกเก็บไว้

### 2. ตั้งค่า Next.js Project

```bash
npx create-next-app@latest dharma-chatbot --typescript --app
cd dharma-chatbot

# คัดลอกไฟล์จาก repo นี้ไปใส่
# lib/providers.ts
# lib/cache.ts
# lib/suttacentral.ts
# app/api/chat/route.ts

# ตั้งค่า environment
cp .env.example .env.local
# แก้ไขใส่ key จริง
```

### 3. Deploy ขึ้น Vercel

```bash
npm install -g vercel
vercel deploy

# ใส่ env vars ใน Vercel Dashboard:
# Settings → Environment Variables
# GROQ_API_KEYS = gsk_xxx,gsk_yyy   (คั่นด้วย comma ถ้ามีหลาย key)
# GEMINI_API_KEY = AIza_xxx
```

### 4. ตั้ง Cloudflare Worker (สำหรับ cache + load balance)

```bash
npm install -g wrangler
cd cloudflare-worker

# สร้าง KV namespace สำหรับ cache
wrangler kv:namespace create "DHARMA_CACHE"
# จะได้ ID มา ใส่ใน wrangler.toml

# Deploy
wrangler deploy
```

**wrangler.toml** (สร้างใน cloudflare-worker/)
```toml
name = "dharma-lb"
main = "load-balancer.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"

[vars]
BACKEND_URLS = "https://your-app.vercel.app"
ALLOWED_ORIGIN = "https://your-app.vercel.app"
```

## ความสามารถรองรับผู้ใช้

| ระดับ | ผู้ใช้พร้อมกัน | ค่าใช้จ่าย |
|---|---|---|
| Groq เดียว | ~15 คน | ฿0 |
| Groq 3 keys | ~45 คน | ฿0 |
| + Gemini fallback | ~80 คน | ฿0 |
| + Cloudflare cache | ~200 คน | ฿0 |
| + Cloudflare cache + คำถามซ้ำสูง | ~500 คน | ฿0 |

> **หมายเหตุ:** แอปธรรมะได้ประโยชน์จาก cache สูงมาก เพราะคำถามซ้ำกันบ่อย
> คำถาม Top 20 (ทุกข์, นิพพาน, ไตรลักษณ์ ฯลฯ) อาจคิดเป็น 60–70% ของ traffic ทั้งหมด

## โครงสร้างไฟล์

```
dharma-chatbot/
├── app/
│   └── api/
│       └── chat/
│           └── route.ts       ← main API endpoint
├── lib/
│   ├── providers.ts           ← Groq + Gemini router
│   ├── cache.ts               ← in-memory cache
│   └── suttacentral.ts        ← ดึงพระสูตรจริง
├── cloudflare-worker/
│   └── load-balancer.js       ← edge layer (ฟรี)
└── .env.example
```
