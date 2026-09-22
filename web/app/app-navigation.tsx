import { productSpaceHref, type ProductSpace } from "./product-space";
import "./app-navigation.css";
import { MenuIcon } from "./menu-icon";

const destinations = [
  { space: "ONBOARDING", label: "홈" },
  { space: "TEAM", label: "내 팀" },
  { space: "DRAFT", label: "밴픽" },
  { space: "RADAR", label: "메타" },
] as const;

export function AppNavigation({ currentSpace }: { currentSpace: ProductSpace }) {
  return <nav className="app-bottom-navigation" aria-label="주요 메뉴">{destinations.map((item) => <a key={item.space} href={productSpaceHref(currentSpace, item.space)} aria-current={currentSpace === item.space ? "page" : undefined}><MenuIcon name={item.space} /><strong>{item.label}</strong></a>)}<a href={`${productSpaceHref(currentSpace, "ONBOARDING")}#home-spaces`}><MenuIcon name="MENU" /><strong>전체 메뉴</strong></a></nav>;
}
