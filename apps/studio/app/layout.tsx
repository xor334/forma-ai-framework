import type { ReactNode } from 'react'
import './studio.css'
export const metadata = { title: 'Forma · Студия проекта' }
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  )
}
