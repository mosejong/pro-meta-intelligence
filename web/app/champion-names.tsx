"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { championAssetId, championCatalogUrl, DATA_DRAGON_VERSION } from "./champion-assets";

export type ChampionNameCatalog = Record<string, string>;

const STORAGE_KEY = `pro-meta:champion-names:ko_KR:${DATA_DRAGON_VERSION}`;

// Immediate, offline-safe official Korean names (Data Dragon ko_KR), so names show in Korean even when the
// CDN is slow or blocked. The live Data Dragon catalog still overrides these after hydration. Champions
// whose Korean name has not been verified here (e.g. Locke, Yunara, Zaahen) fall back to the canonical id.
export const fallbackChampionNames: ChampionNameCatalog = {
  Aatrox: "아트록스",
  Ahri: "아리",
  Akali: "아칼리",
  Akshan: "아크샨",
  Alistar: "알리스타",
  Ambessa: "암베사",
  Amumu: "아무무",
  Anivia: "애니비아",
  Annie: "애니",
  Aphelios: "아펠리오스",
  Ashe: "애쉬",
  AurelionSol: "아우렐리온 솔",
  Aurora: "오로라",
  Azir: "아지르",
  Bard: "바드",
  Belveth: "벨베스",
  Blitzcrank: "블리츠크랭크",
  Brand: "브랜드",
  Braum: "브라움",
  Briar: "브라이어",
  Caitlyn: "케이틀린",
  Camille: "카밀",
  Cassiopeia: "카시오페아",
  Chogath: "초가스",
  Corki: "코르키",
  Darius: "다리우스",
  Diana: "다이애나",
  DrMundo: "문도 박사",
  Mundo: "문도 박사",
  Draven: "드레이븐",
  Ekko: "에코",
  Elise: "엘리스",
  Evelynn: "이블린",
  Ezreal: "이즈리얼",
  Fiddlesticks: "피들스틱",
  Fiora: "피오라",
  Fizz: "피즈",
  Galio: "갈리오",
  Gangplank: "갱플랭크",
  Garen: "가렌",
  Gnar: "나르",
  Gragas: "그라가스",
  Graves: "그레이브즈",
  Gwen: "그웬",
  Hecarim: "헤카림",
  Heimerdinger: "하이머딩거",
  Hwei: "흐웨이",
  Illaoi: "일라오이",
  Irelia: "이렐리아",
  Ivern: "아이번",
  Janna: "잔나",
  JarvanIV: "자르반 4세",
  Jax: "잭스",
  Jayce: "제이스",
  Jhin: "진",
  Jinx: "징크스",
  KSante: "크산테",
  Kaisa: "카이사",
  Kalista: "칼리스타",
  Karma: "카르마",
  Karthus: "카서스",
  Kassadin: "카사딘",
  Katarina: "카타리나",
  Kayle: "케일",
  Kayn: "케인",
  Kennen: "케넨",
  Khazix: "카직스",
  Kindred: "킨드레드",
  Kled: "클레드",
  KogMaw: "코그모",
  LeBlanc: "르블랑",
  Leblanc: "르블랑",
  LeeSin: "리 신",
  Leona: "레오나",
  Lillia: "릴리아",
  Lissandra: "리산드라",
  Lucian: "루시안",
  Lulu: "룰루",
  Lux: "럭스",
  Malphite: "말파이트",
  Malzahar: "말자하",
  Maokai: "마오카이",
  MasterYi: "마스터 이",
  Mel: "멜",
  Milio: "밀리오",
  MissFortune: "미스 포츈",
  MonkeyKing: "오공",
  Wukong: "오공",
  Mordekaiser: "모데카이저",
  Morgana: "모르가나",
  Naafiri: "나피리",
  Nami: "나미",
  Nasus: "나서스",
  Nautilus: "노틸러스",
  Neeko: "니코",
  Nidalee: "니달리",
  Nilah: "닐라",
  Nocturne: "녹턴",
  Nunu: "누누와 윌럼프",
  Olaf: "올라프",
  Orianna: "오리아나",
  Ornn: "오른",
  Pantheon: "판테온",
  Poppy: "뽀삐",
  Pyke: "파이크",
  Qiyana: "키아나",
  Quinn: "퀸",
  Rakan: "라칸",
  Rammus: "람머스",
  RekSai: "렉사이",
  Rell: "렐",
  Renata: "레나타 글라스크",
  Renekton: "레넥톤",
  Rengar: "렝가",
  Riven: "리븐",
  Rumble: "럼블",
  Ryze: "라이즈",
  Samira: "사미라",
  Sejuani: "세주아니",
  Senna: "세나",
  Seraphine: "세라핀",
  Sett: "세트",
  Shaco: "샤코",
  Shen: "쉔",
  Shyvana: "쉬바나",
  Singed: "신지드",
  Sion: "사이온",
  Sivir: "시비르",
  Skarner: "스카너",
  Smolder: "스몰더",
  Sona: "소나",
  Soraka: "소라카",
  Swain: "스웨인",
  Sylas: "사일러스",
  Syndra: "신드라",
  TahmKench: "탐 켄치",
  Taliyah: "탈리야",
  Talon: "탈론",
  Taric: "타릭",
  Teemo: "티모",
  Thresh: "쓰레쉬",
  Tristana: "트리스타나",
  Trundle: "트런들",
  Tryndamere: "트린다미어",
  TwistedFate: "트위스티드 페이트",
  Twitch: "트위치",
  Udyr: "우디르",
  Urgot: "우르곳",
  Varus: "바루스",
  Vayne: "베인",
  Veigar: "베이가",
  Velkoz: "벨코즈",
  Vex: "벡스",
  Vi: "바이",
  Viego: "비에고",
  Viktor: "빅토르",
  Vladimir: "블라디미르",
  Volibear: "볼리베어",
  Warwick: "워윅",
  Xayah: "자야",
  Xerath: "제라스",
  XinZhao: "신 짜오",
  Yasuo: "야스오",
  Yone: "요네",
  Yorick: "요릭",
  Yuumi: "유미",
  Zac: "자크",
  Zed: "제드",
  Zeri: "제리",
  Ziggs: "직스",
  Zilean: "질리언",
  Zoe: "조이",
  Zyra: "자이라",
};

type ChampionCatalogPayload = {
  data?: Record<string, { id?: unknown; name?: unknown }>;
};

export function parseChampionNameCatalog(payload: unknown): ChampionNameCatalog {
  if (!payload || typeof payload !== "object") return {};
  const data = (payload as ChampionCatalogPayload).data;
  if (!data || typeof data !== "object") return {};

  return Object.entries(data).reduce<ChampionNameCatalog>((catalog, [assetId, entry]) => {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.name !== "string") {
      return catalog;
    }
    const name = entry.name.trim();
    if (!name) return catalog;
    catalog[assetId] = name;
    catalog[entry.id] = name;
    return catalog;
  }, {});
}

export function championDisplayName(championId: string, catalog: ChampionNameCatalog = fallbackChampionNames) {
  return catalog[championId] ?? catalog[championAssetId(championId)] ?? fallbackChampionNames[championId] ?? fallbackChampionNames[championAssetId(championId)] ?? championId;
}

function normalizedSearchValue(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("ko-KR").replace(/[^\p{L}\p{N}]/gu, "");
}

export function matchesChampionQuery(championId: string, query: string, catalog: ChampionNameCatalog = fallbackChampionNames) {
  const needle = normalizedSearchValue(query.trim());
  if (!needle) return true;
  return [championId, championAssetId(championId), championDisplayName(championId, catalog)]
    .some((candidate) => normalizedSearchValue(candidate).includes(needle));
}

type ChampionNamesContextValue = {
  catalog: ChampionNameCatalog;
  nameOf: (championId: string) => string;
  matches: (championId: string, query: string) => boolean;
};

const ChampionNamesContext = createContext<ChampionNamesContextValue>({
  catalog: fallbackChampionNames,
  nameOf: (championId) => championDisplayName(championId),
  matches: (championId, query) => matchesChampionQuery(championId, query),
});

export function ChampionNameProvider({ children }: { children: ReactNode }) {
  const [catalog, setCatalog] = useState<ChampionNameCatalog>(fallbackChampionNames);

  useEffect(() => {
    let active = true;
    try {
      const cached = window.localStorage.getItem(STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as ChampionNameCatalog;
        if (parsed && typeof parsed === "object") {
          window.setTimeout(() => {
            if (active) setCatalog({ ...fallbackChampionNames, ...parsed });
          }, 0);
        }
      }
    } catch {
      // Privacy modes may deny storage. The network catalog can still load.
    }

    fetch(championCatalogUrl("ko_KR"))
      .then((response) => {
        if (!response.ok) throw new Error(`Champion catalog request failed: ${response.status}`);
        return response.json() as Promise<unknown>;
      })
      .then((payload) => {
        const parsed = parseChampionNameCatalog(payload);
        if (!Object.keys(parsed).length) throw new Error("Champion catalog was empty");
        if (active) setCatalog({ ...fallbackChampionNames, ...parsed });
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        } catch {
          // A full storage area must not block the public dashboard.
        }
      })
      .catch(() => {
        // Keep the bounded local fallback. Champion IDs remain readable.
      });

    return () => { active = false; };
  }, []);

  const nameOf = useCallback((championId: string) => championDisplayName(championId, catalog), [catalog]);
  const matches = useCallback((championId: string, query: string) => matchesChampionQuery(championId, query, catalog), [catalog]);
  const value = useMemo(() => ({ catalog, nameOf, matches }), [catalog, matches, nameOf]);

  return <ChampionNamesContext.Provider value={value}>{children}</ChampionNamesContext.Provider>;
}

export function useChampionNames() {
  return useContext(ChampionNamesContext);
}
