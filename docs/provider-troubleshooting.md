# ตรวจและแก้การเชื่อมต่อ AI

ตรวจเมื่อ 2026-10-11: เว็บเปิดได้และค้น SuttaCentral ได้ แต่ทั้งการเลือก Groq และ Gemini คืนข้อความผิดพลาดทั่วไป โค้ดเดิมทิ้งสาเหตุจากผู้ให้บริการทั้งหมด จึงยังสรุปไม่ได้ว่า Groq ล้มเหลวเพราะ key, quota หรือบริการ upstream

Gemini เดิมใช้ `gemini-2.0-flash` ซึ่งเอกสาร Google ระบุ shutdown วันที่ 2026-06-01: https://ai.google.dev/gemini-api/docs/deprecations

## ตั้งค่าบน Vercel

เปิด Project → Settings → Environment Variables ตั้ง `GEMINI_MODEL` เป็นโมเดลที่บัญชีเข้าถึงได้ (ค่าเริ่มต้นใหม่ `gemini-3.5-flash-lite`) และ `GROQ_MODEL` หากต้องเปลี่ยนโมเดล Groq ตรวจโควตาและ billing ของบัญชีก่อนใช้ โมเดลหรือ key ที่ตั้งไว้ไม่ได้เป็นหลักฐานว่าคำขอจะสำเร็จ ไม่มีการเปิด billing หรือเพิ่ม provider ใหม่ในงานนี้

หลังเปลี่ยนตัวแปรต้อง redeploy จากนั้นถามคำถามใหม่ที่ไม่เคย cache เพื่อพิสูจน์การเรียกจริง ตรวจ provider ของคำตอบ เพราะการเลือกโมเดลเป็นการลองก่อนและยัง fallback ได้ตาม `PROVIDER_ORDER`

## อ่าน Runtime Logs

ส่งคำถามในเว็บ → เปิด Vercel Project → Logs ค้น `AI_PROVIDER_FAILURE` โดยดูเวลาตรงกับคำขอ:

| kind | ความหมาย / สิ่งที่ต้องตรวจ |
| --- | --- |
| authentication | HTTP 401/403: key หมดอายุ ผิด project หรือไม่มีสิทธิ์ |
| rate_limit | HTTP 429: โควตาหมดหรือเกิน rate limit ตรวจ dashboard ของ provider |
| model | HTTP 400/404/410: โมเดล/คำขอไม่รองรับ ตรวจชื่อโมเดลและสิทธิ์ |
| timeout | เกินเวลารอ |
| configuration | ไม่ได้ตั้งค่าครบ provider นี้ถูกข้าม |
| network/upstream | เครือข่ายหรือบริการ upstream ล้มเหลว |
| empty | stream จบโดยไม่มีข้อความ |

Logs บันทึกเฉพาะชื่อ provider, kind และ HTTP status ไม่บันทึก key, URL ของคำขอ, คำถาม หรือ response body อย่าส่ง key ลงแชตหรือ commit

## เกณฑ์ตรวจหลังแก้

- Groq และ Gemini แต่ละตัวตอบคำถามใหม่ได้พร้อม provider ที่ใช้จริง
- stream ต้องจบด้วยคำตอบ ไม่ใช่ข้อความผิดพลาดหรือคำตอบว่าง
- ลิงก์อ้างอิงเปิดได้และเกี่ยวข้องกับคำตอบ
- เมื่อบริการล้มเหลว หน้าเว็บไม่แสดงป้ายว่าคำตอบอ้างอิงพระไตรปิฎก
- การทดสอบ mocks พิสูจน์ตรรกะเท่านั้น ต้องทดสอบ production แยกก่อนประกาศว่าซ่อมแล้ว
