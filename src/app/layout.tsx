import type { Metadata } from "next";
import "./globals.css";
import "./coffice-unified.css";

export const metadata: Metadata = {
  title: "Coffice",
  description: "A little desktop office where your Codex agents come to life.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
