import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LASH GOLDEN",
  description: "Учёт визитов и зарплаты салона LASH GOLDEN",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
