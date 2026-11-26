import type { Metadata } from "next";
import { Tilt_Warp, Hanken_Grotesk, Azeret_Mono } from "next/font/google";
import "./globals.css";
import "./chrome.css";
import "./site.css";
import "./app.css";
import Providers from "@/components/Providers";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

const display = Tilt_Warp({ variable: "--font-display", subsets: ["latin"], axes: ["XROT", "YROT"] });
const body = Hanken_Grotesk({ variable: "--font-body", subsets: ["latin"] });
const mono = Azeret_Mono({ variable: "--font-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Steady",
  description: "Paste a Solana wallet. Steady reads it from mainnet, tells you in plain words what could hurt it, buys what the chain cannot know from Telegraph miners, hands you the fix to sign in Phantom, and keeps watching on Telegram.",
};

const themeScript = `try{var t=localStorage.getItem("steady-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <Providers>
          <Nav />
          <main>{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
