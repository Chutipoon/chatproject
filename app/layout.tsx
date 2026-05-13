// app/layout.tsx
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "ธรรมสหาย — ผู้ช่วยด้านพุทธธรรม",
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
