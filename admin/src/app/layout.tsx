import type { Metadata, Viewport } from 'next';
import { Big_Shoulders, Instrument_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { SessionProvider } from '@/lib/session';
import './globals.css';
import './landing.css';

// §12 fonts: Big Shoulders Display for big numbers and page titles; Instrument Sans for everything else.
// Google Fonts now ships Big Shoulders Display as the "Big Shoulders" family with an optical-size
// axis; at display sizes the browser picks the Display cut (font-optical-sizing: auto).
const display = Big_Shoulders({ subsets: ['latin'], weight: 'variable', axes: ['opsz'], variable: '--font-big-shoulders', display: 'swap',
  adjustFontFallback: false, fallback: ['Arial Narrow', 'sans-serif'] });
const body = Instrument_Sans({ subsets: ['latin'], variable: '--font-instrument', display: 'swap' });

export const metadata: Metadata = {
  title: 'Gym Admin',
  description: 'Members, fees, check-ins and training plans for your gym.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
