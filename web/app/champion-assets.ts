export const DATA_DRAGON_VERSION = "16.16.1";

const championAssetOverrides: Record<string, string> = {
  "Cho'Gath": "Chogath",
  "Kai'Sa": "Kaisa",
  "Kha'Zix": "Khazix",
  LeBlanc: "Leblanc",
  Mundo: "DrMundo",
  "Renata Glasc": "Renata",
  Wukong: "MonkeyKing",
};

export function championAssetId(championId: string) {
  return championAssetOverrides[championId] ?? championId.replace(/[.'\s]/g, "");
}

export function championImageUrl(championId: string) {
  return `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/img/champion/${championAssetId(championId)}.png`;
}

export function championSplashUrl(championId: string) {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${championAssetId(championId)}_0.jpg`;
}

export function championCatalogUrl(locale = "ko_KR") {
  return `https://ddragon.leagueoflegends.com/cdn/${DATA_DRAGON_VERSION}/data/${locale}/champion.json`;
}
