import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ProAssist — Proactive AI Assistant",
  description: "AI-powered assistant that learns your patterns and suggests rides and food orders before you need them. Compare across Uber, Ola, Rapido, Swiggy, and Zomato.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0a0a0f" />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
