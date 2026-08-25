export type ProductSpace = "ONBOARDING" | "TEAM" | "T1" | "CREATOR" | "RADAR";

const slugs: Record<ProductSpace, string> = {
  ONBOARDING: "",
  TEAM: "team/",
  T1: "t1/",
  CREATOR: "creator/",
  RADAR: "radar/",
};

export function productSpaceFromPath(pathname: string): ProductSpace {
  const segments = pathname.toLowerCase().split("/").filter(Boolean);
  const leaf = segments.at(-1) === "index.html" ? segments.at(-2) : segments.at(-1);
  if (leaf === "team") return "TEAM";
  if (leaf === "t1") return "T1";
  if (leaf === "creator") return "CREATOR";
  if (leaf === "radar") return "RADAR";
  return "ONBOARDING";
}

export function productRootHref(current: ProductSpace) {
  return current === "ONBOARDING" ? "./" : "../";
}

export function productSpaceHref(current: ProductSpace, target: ProductSpace) {
  return `${productRootHref(current)}${slugs[target]}`;
}
