import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Circuit Sim (Konva)",
  description: "Drag-and-drop DC circuit simulator (R, V, I, GND) using Next.js + Konva + MNA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
