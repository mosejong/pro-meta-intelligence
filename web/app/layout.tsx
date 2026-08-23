import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export async function generateMetadata(): Promise<Metadata> {
  const incoming = await headers();
  const host = incoming.get("x-forwarded-host") ?? incoming.get("host") ?? "localhost:3000";
  const protocol = incoming.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/meta-radar-hero-v2.png`;
  const title = "Meta Radar · Pro Meta Intelligence";
  const description = "프로 경기 픽 변화를 근거와 함께 탐색하는 설명 가능한 메타 레이더";

  return {
    title,
    description,
    openGraph: { title, description, type: "website", images: [{ url: image, width: 1672, height: 940, alt: "지역별 메타 신호가 하나의 후보로 모이는 Meta Radar 일러스트" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
