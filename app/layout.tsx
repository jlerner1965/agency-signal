import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgencySignal — Digital Presence Audits",
  description: "Evidence-led website audits and a practical outreach pipeline for local businesses.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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
