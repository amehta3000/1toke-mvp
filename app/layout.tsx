import './globals.css';

export const metadata = {
  title: '1Toke MVP',
  description: 'Fast personal strain buying assistant and journal'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
