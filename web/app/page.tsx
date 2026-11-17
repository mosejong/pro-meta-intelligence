import type { Metadata } from "next";
import { RadarDashboard } from "./radar-dashboard";

export const metadata: Metadata = {
  title: "Pro Meta Intelligence · 공개 팀 분석 플랫폼",
  description: "양 팀을 골라 표준 5밴 5픽 모의 밴픽을 바로 진행하고, 선택한 챔피언의 공개 경기 표본과 상세 분석을 확인합니다.",
};

export default function Home() {
  return <RadarDashboard initialSpace="ONBOARDING" />;
}
