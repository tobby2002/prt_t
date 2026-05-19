import type { Metadata } from "next";
import "./globals.css";

// 프론트엔드 레이아웃 코드
export const metadata: Metadata = {
  title: "prj_t · Backtrader FE",
  description: "Backtrader 백테스트 결과 뷰어",
};

// 루트레이아웃 함수
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <body className="min-h-full flex flex-col font-sans" suppressHydrationWarning>{children}</body>
    </html>
  );
}
