import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#480816",
};

export const metadata: Metadata = {
  title: "His Mercy @15",
  description:
    "Be part of the 15th Annual Adult Harvest of Celestial Church of Christ, His Mercy Parish (Confirm Ministry). Upload your photo, enter your name, and download your personalised attendance poster.",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "His Mercy @15",
    description:
      "Create your personalised 'I Will Be There' attendance poster for the 15th Annual Adult Harvest of CCC His Mercy Parish (Confirm Ministry).",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "His Mercy @15",
    description:
      "Create your personalised 'I Will Be There' attendance poster for the 15th Annual Adult Harvest of CCC His Mercy Parish.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-[#f5b82e] selection:text-[#3d0613]">
        {children}
      </body>
    </html>
  );
}
