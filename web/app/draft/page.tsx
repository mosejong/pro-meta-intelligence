import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "Draft Lab · Pro Meta Intelligence",
  description: "T1을 기본 팀으로 실제 프로 밴픽 순서를 재현하고 공개 근거 기반의 턴별 시나리오를 비교합니다.",
};

export default function DraftPage() {
  return <RadarDashboard initialSpace="DRAFT" />;
}
