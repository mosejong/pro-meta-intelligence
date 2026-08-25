import type { Metadata } from "next";
import { RadarDashboard } from "../radar-dashboard";

export const metadata: Metadata = {
  title: "T1 브리프 · Pro Meta Intelligence",
  description: "T1의 공식 일정과 공개 경기 근거를 한 장의 준비 브리프로 압축합니다.",
};

export default function T1Page() {
  return <RadarDashboard initialSpace="T1" />;
}
