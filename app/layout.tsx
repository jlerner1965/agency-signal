import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgencySignal — Audit-to-Sale Workspace",
  description: "Evidence-led website audits and sales pipeline management for local insurance agencies.",
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
