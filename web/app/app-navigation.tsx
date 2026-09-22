import { productSpaceHref, type ProductSpace } from "./product-space";
import "./app-navigation.css";

const destinations = [
  { space: "ONBOARDING", label: "홈", icon: "⌂" },
  { space: "TEAM", label: "내 팀", icon: "◉" },
  { space: "DRAFT", label: "밴픽", icon: "⇄" },
  { space: "RADAR", label: "메타", icon: "◎" },
] as const;

export function AppNavigation({ currentSpace }: { currentSpace: ProductSpace }) {
  return <nav className="app-bottom-navigation" aria-label="주요 메뉴">{destinations.map((item) => <a key={item.space} href={productSpaceHref(currentSpace, item.space)} aria-current={currentSpace === item.space ? "page" : undefined}><span aria-hidden="true">{item.icon}</span><strong>{item.label}</strong></a>)}<a href={`${productSpaceHref(currentSpace, "ONBOARDING")}#home-spaces`}><span aria-hidden="true">☰</span><strong>전체 메뉴</strong></a></nav>;
}
