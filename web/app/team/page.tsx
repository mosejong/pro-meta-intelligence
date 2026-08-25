import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "팀 분석 · Pro Meta Intelligence",
  description: "소속 팀 관점에서 상대 우선순위, 검토 후보와 드래프트 배틀카드를 정리합니다.",
};

export default function TeamPage() {
  return <RadarDashboard initialSpace="TEAM" />;
}
