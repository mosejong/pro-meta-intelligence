import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "제출 증거 · Pro Meta Intelligence",
  description: "T1 중심 분석 제품의 문제, 라이브 사례, 검증 상태와 3분 시연 흐름을 확인합니다.",
};

export default function ProofPage() {
  return <RadarDashboard initialSpace="PROOF" />;
}
