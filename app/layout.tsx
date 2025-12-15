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
  metadataBase: new URL('https://ror.chat'),
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  manifest: '/site.webmanifest',
  openGraph: {
    title: 'rorchat. — Talk to Rory.',
    description: 'Start a conversation with Rory. Simple, fast, straightforward.',
    url: 'https://ror.chat',
    siteName: 'rorchat.',
    locale: 'en_US',
    type: 'website',
    images: [
      {
        url: 'https://ror.chat/opengraph-image.jpg',
        width: 2848,
        height: 1504,
        alt: 'rorchat. — Reach Rory, Today',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'rorchat. — Talk to Rory.',
    description: 'Start a conversation with Rory. Simple, fast, straightforward.',
    images: ['https://ror.chat/opengraph-image.jpg'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#000',
  interactiveWidget: 'resizes-content',
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

