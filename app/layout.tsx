import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fertilizer CBAM | Aramco Hackathon",
  description: "Review fertilizer shipment documents with the Upstage workflow.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
