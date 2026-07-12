import './globals.css';
import type { Viewport } from 'next';

export const metadata = {
  title: '1Toke — your pocket budtender',
  description: 'Scan a label, ask about a strain, get a straight Buy / Maybe / Skip scored against your own vibe.'
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f1115'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
