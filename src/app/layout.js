import './globals.css';

export const metadata = {
  title: 'Arimann Bid Command Center',
  description: 'Bid tracking and management for Arimann Building Services',
  icons: { icon: '/logo.png' },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
