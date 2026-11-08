import "./globals.css";
import type { Metadata, Viewport } from "next";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: "Training Task Hub",
  description: "Tasks from emails, training tracker and daily attendance",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#1f2a44" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
