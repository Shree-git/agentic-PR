import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Incident PR Autopilot",
  description: "Composio-powered incident-to-PR execution agent"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
