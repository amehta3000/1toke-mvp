import { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '1Toke — your pocket budtender',
    short_name: '1Toke',
    description: 'Scan a label, ask about a strain, get a straight Buy / Maybe / Skip scored against your own vibe.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f1115',
    theme_color: '#0f1115',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    // Long-press the home-screen icon to jump straight to Scan — page.tsx
    // reads ?action=scan and briefly arms the Snap tile so the one tap that
    // opens the camera is right there, no navigating through tabs first.
    shortcuts: [
      {
        name: 'Scan a label',
        short_name: 'Scan',
        description: 'Jump straight to scanning a product',
        url: '/?action=scan',
        icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }]
      }
    ]
  };
}
