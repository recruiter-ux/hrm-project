import type { Metadata } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: '[PROJECT_NAME]',
  description: 'Internal HR platform for Hazel Mobile',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
