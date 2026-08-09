// app/layout.tsx
import type { Metadata, Viewport } from "next"
import "./globals.css"

// ค่า default ของสเปกคือ resizes-visual = แป้นพิมพ์หดแค่ visual viewport
// ส่วน 100dvh อิง layout viewport จึงไม่หด → ช่องพิมพ์ไปอยู่ใต้แป้นพิมพ์
// resizes-content สั่งให้ layout viewport หดด้วย (Chrome/Android 108+)
// iOS Safari ยังไม่รองรับ — ตัวสำรองอยู่ใน page.tsx (visualViewport → --kb)
// ประกาศ viewport เองแล้วต้องใส่ width/initialScale เอง เพราะมันแทนค่า default
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
}

export const metadata: Metadata = {
  title: "ธรรมดู — ผู้ช่วยด้านพุทธธรรม",
  description: "แชตบอตพุทธธรรมดิจิทัล ตอบโดยอ้างอิงพระไตรปิฎกจริง",
  icons: { icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>☸</text></svg>" },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
