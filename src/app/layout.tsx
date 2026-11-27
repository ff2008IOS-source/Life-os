import localFont from "next/font/local";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./consumer.css";
import "./warm.css";
import "./today.css";
import "./living.css";
import "./shapes.css";
import { Providers } from "@/components/providers";
const interfaceFont = localFont({
  src: "./fonts/inter-latin.woff2",
  variable: "--font-interface",
  weight: "400 600",
  display: "swap",
});
const editorialFont = localFont({
  src: "./fonts/instrument-serif-latin.woff2",
  variable: "--font-editorial",
  weight: "400",
  display: "swap",
});
export const metadata: Metadata = {
  title: {
    default: "Life OS",
    template: "%s · Life OS",
  },
  description: "Your tasks, schedule and workspaces.",
  robots: { index: false, follow: false },
  applicationName: "Life OS",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1114" },
  ],
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${interfaceFont.variable} ${editorialFont.variable}`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
