import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TBL Live — Team-Based Learning",
  description:
    "Application gratuite d'apprentissage en équipe (Team-Based Learning) pour l'enseignement : tests individuels (iRAT), tests en équipe (tRAT), réclamations, exercices d'application et évaluation par les pairs, en temps réel.",
  keywords: [
    "TBL",
    "Team-Based Learning",
    "apprentissage en équipe",
    "enseignement",
    "iRAT",
    "tRAT",
    "évaluation par les pairs",
  ],
  applicationName: "TBL Live",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TBL Live",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#059669",
  width: "device-width",
  initialScale: 1,
  // Zoom tactile autorisé (accessibilité WCAG 1.4.4 — élèves malvoyants)
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-stone-50 text-stone-900`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
