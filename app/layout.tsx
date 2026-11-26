import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "KUC | Carbon compliance review",
  description: "Check shipment documents and review supporting evidence with Know Your Carbon.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
