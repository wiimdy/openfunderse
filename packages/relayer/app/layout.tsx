import './globals.css';

import { GeistSans } from 'geist/font/sans';

let title = 'Claw Relayer';
let description =
  'Claw relayer app with admin-id login and weighted attestation APIs.';

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
