import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./consumer.css";
import { Providers } from "@/components/providers";
export const metadata: Metadata = {
  title: {
    default: "Life OS — Your life, organized",
    template: "%s · Life OS",
  },
  description: "Your private space for a more intentional day.",
  robots: { index: false, follow: false },
  applicationName: "Life OS",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1020" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
