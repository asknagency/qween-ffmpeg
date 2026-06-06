import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QweenFFmpeg',
  description: 'Frame-to-video pipeline powered by ffmpeg',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
