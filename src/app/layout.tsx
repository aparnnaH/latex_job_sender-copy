import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TailorTeX",
  description: "AI-assisted LaTeX resume tailoring with human review and source-safe exports."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
