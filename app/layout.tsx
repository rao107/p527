import type { Metadata } from "next";
import { Libre_Baskerville } from "next/font/google";
import "./globals.css";

const baskerville = Libre_Baskerville({
  variable: "--font-baskerville",
  weight: ["400", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fathom",
  description: "Explore the universe through Wikidata",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${baskerville.variable} antialiased font-serif`}
        style={{ fontFamily: "var(--font-baskerville), serif" }}
      >
        {children}
      </body>
    </html>
  );
}
