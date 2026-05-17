import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "prj_t · Backtrader",
  description: "Backtrader 백테스트 결과 뷰어",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
