import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "Meta Radar · Pro Meta Intelligence",
  description: "지역 차이, 수요 속도, 표본 경고와 원본 이벤트를 직접 탐색합니다.",
};

export default function RadarPage() {
  return <RadarDashboard initialSpace="RADAR" />;
}
