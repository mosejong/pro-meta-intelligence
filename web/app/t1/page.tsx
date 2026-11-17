import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "팀 분석 · Pro Meta Intelligence",
  description: "선택한 양 팀의 공개 경기와 밴픽 근거를 비교합니다.",
};

export default function T1Page() {
  return <RadarDashboard initialSpace="TEAM" />;
}
