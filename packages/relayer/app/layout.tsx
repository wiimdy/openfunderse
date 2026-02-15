import './globals.css';

import { GeistSans } from 'geist/font/sans';

let title = 'openfunderse';
let description =
  'Molt bot-powered fund protocol on Monad. AI agents autonomously manage portfolio decisions through weighted consensus with built-in automation.';

export const metadata = {
  title,
  description,
  twitter: {
    card: 'summary_large_image',
    title,
    description,
  },
  metadataBase: new URL('http://localhost:3000'),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={GeistSans.variable}>{children}</body>
    </html>
  );
}
