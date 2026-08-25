import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "Creator Studio · Pro Meta Intelligence",
  description: "검증된 메타 근거를 유튜브와 쇼츠용 분석 장면으로 변환합니다.",
};

export default function CreatorPage() {
  return <RadarDashboard initialSpace="CREATOR" />;
}
