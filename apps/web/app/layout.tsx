import { ConvexClientProvider } from "@/core/providers/convex-provider";
import { PwaProvider } from "@/core/providers/pwa-provider";
import { WalletProvider } from "@/core/wallet/wallet-provider";
import UiProviders from "@repo/ui/ui-providers";
import { Analytics } from "@vercel/analytics/next";
import localFont from "next/font/local";
import Script from "next/script";

import type { Metadata, Viewport } from "next";

import "./globals.css";
const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://velo.local"),
  icons: { icon: { url: "/velo-favicon.png", type: "image/png", sizes: "184x174" } },
  title: "Velo",
  description: "Verified developer infrastructure for Stellar apps",
  keywords: ["stellar", "soroban", "developer tools", "verification", "debugging"],
  openGraph: {
    siteName: "Velo",
    title: "Velo",
    description: "Verified developer infrastructure for Stellar apps",
    images: "/banner.png",
    type: "website",
  },
  twitter: {
    title: "Velo",
    description: "Verified developer infrastructure for Stellar apps",
    images: "/banner.png",
    card: "summary_large_image",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <WalletProvider>
          <ConvexClientProvider>
            <UiProviders>
              <PwaProvider>{children}</PwaProvider>
            </UiProviders>
          </ConvexClientProvider>
        </WalletProvider>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-KSXQ5MBNLK"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){window.dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-KSXQ5MBNLK');
          `}
        </Script>
        <Analytics />
      </body>
    </html>
  );
}
