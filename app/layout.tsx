import './globals.css';
import type { Viewport } from 'next';
import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: '1Toke — your pocket budtender',
  description: 'Scan a label, ask about a strain, get a straight Buy / Maybe / Skip scored against your own vibe.',
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png'
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent' as const,
    title: '1Toke'
  }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1115'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
