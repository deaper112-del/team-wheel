import type { Metadata } from "next";
import "../src/style.css";

export const metadata: Metadata = {
  title: "在线考试",
  description: "监考发布试卷，考生填写姓名后作答。",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230c5c56'/%3E%3Ctext x='32' y='44' text-anchor='middle' font-size='36' fill='%23f6f3ea' font-family='sans-serif'%3E考%3C/text%3E%3C/svg%3E",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
