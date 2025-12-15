import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'rorchat. Admin',
  description: 'Admin panel for rorchat',
  manifest: '/admin.webmanifest',
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#635bff',
  interactiveWidget: 'resizes-content',
}

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
