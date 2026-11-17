import type { ProductSpace } from "./product-space";

// Team-neutral routing: no team name is special-cased, and questions about schedules,
// opponents or players open the generic team analysis for whichever teams the user selects.
const intentTerms: Array<{ space: ProductSpace; terms: string[] }> = [
  {
    space: "CREATOR",
    terms: ["영상", "유튜브", "쇼츠", "콘텐츠", "대본", "썸네일", "creator"],
  },
  {
    space: "DRAFT",
    terms: ["가상 밴픽", "모의 밴픽", "밴픽 시뮬", "밴픽 연습", "드래프트", "픽밴", "밴픽", "draft"],
  },
  {
    space: "TEAM",
    terms: ["내 팀", "우리 팀", "소속팀", "상대 우선", "배틀카드", "다음 상대", "다음 경기", "일정", "선수", "팀 분석", "team"],
  },
  {
    space: "RADAR",
    terms: [
      "메타", "정글", "탑", "미드", "원딜", "서포터", "챔피언", "조커픽",
      "급상승", "op", "radar",
    ],
  },
  {
    space: "PROOF",
    terms: ["검증", "증거", "proof"],
  },
];

/** Unknown questions open the mock draft (the product's home), never a fixed team. */
export function homeSpaceForQuestion(question: string): ProductSpace {
  const normalized = question.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  return intentTerms.find(({ terms }) => terms.some((term) => normalized.includes(term)))?.space
    ?? "DRAFT";
}
