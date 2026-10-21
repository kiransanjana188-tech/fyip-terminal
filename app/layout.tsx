import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FYIP TERMINAL — Global Financial Intelligence",
  description:
    "FYIP TERMINAL: multi-asset market intelligence, macro research, derivatives analytics and order-flow workstation.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#07080A",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-base font-sans text-ink antialiased">{children}</body>
    </html>
  );
}