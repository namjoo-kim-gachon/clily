import type { Metadata, Viewport } from "next"
import { Geist_Mono } from "next/font/google"

import "./globals.css"
import { ServiceWorkerRegister } from "@/components/pwa/sw-register"
import { ThemeProvider } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const viewport: Viewport = {
  themeColor: "#000000",
}

export const metadata: Metadata = {
  applicationName: "clily",
  title: "clily",
  description: "Terminal viewer",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "clily",
  },
  formatDetection: {
    telephone: false,
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("antialiased", fontMono.variable, "font-mono")}
    >
      <body>
        <ServiceWorkerRegister />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
