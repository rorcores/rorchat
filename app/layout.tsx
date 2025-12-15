import type { Metadata, Viewport } from 'next'
import { Inter, Plus_Jakarta_Sans } from 'next/font/google'
import './globals.css'

const inter = Inter({ 
  subsets: ['latin'],
  variable: '--font-inter',
})

const plusJakarta = Plus_Jakarta_Sans({ 
  subsets: ['latin'],
  variable: '--font-jakarta',
  weight: ['500', '600', '700', '800'],
})

export const metadata: Metadata = {
  title: 'rorchat. — Talk to Rory.',
  description: 'Start a conversation with Rory. Simple, fast, straightforward.',
  metadataBase: new URL('https://rorchat.com'),
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
  manifest: '/site.webmanifest',
  openGraph: {
    title: 'rorchat. — Talk to Rory.',
    description: 'Start a conversation with Rory. Simple, fast, straightforward.',
    url: 'https://rorchat.com',
    siteName: 'rorchat.',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'rorchat. — Talk to Rory.',
    description: 'Start a conversation with Rory. Simple, fast, straightforward.',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#000',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${plusJakarta.variable}`}>
      <body>{children}</body>
    </html>
  )
}

