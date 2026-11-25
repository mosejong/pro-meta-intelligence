import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "모의 밴픽 · Pro Meta Intelligence",
  description: "프로 팀을 골라 5밴 5픽을 혼자 또는 친구와 연습해 보세요. 상대 차례는 공개 경기 기록을 참고해 자동으로 진행됩니다.",
};

export default function DraftPage() {
  return <RadarDashboard initialSpace="DRAFT" />;
}
