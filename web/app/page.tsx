import type { Metadata } from "next";
import { RadarDashboard } from "./radar-dashboard";

export const metadata: Metadata = {
  title: "Pro Meta Intelligence · 공개 팀 분석 플랫폼",
  description: "공개 경기 근거를 팀 결정, T1 브리프, 분석 콘텐츠와 메타 탐색으로 연결합니다.",
};

export default function Home() {
  return <RadarDashboard initialSpace="ONBOARDING" />;
}
