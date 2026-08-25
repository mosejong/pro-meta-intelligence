import type { ProductSpace } from "./product-space";

const intentTerms: Array<{ space: ProductSpace; terms: string[] }> = [
  {
    space: "CREATOR",
    terms: ["영상", "유튜브", "쇼츠", "콘텐츠", "대본", "썸네일", "creator"],
  },
  {
    space: "TEAM",
    terms: ["내 팀", "우리 팀", "소속팀", "상대 우선", "배틀카드", "team"],
  },
  {
    space: "T1",
    terms: ["t1", "티원", "다음 상대", "다음 경기", "일정", "픽밴", "선수"],
  },
  {
    space: "RADAR",
    terms: [
      "메타", "정글", "탑", "미드", "원딜", "서포터", "챔피언", "조커픽",
      "급상승", "op", "radar",
    ],
  },
];

export function homeSpaceForQuestion(question: string): ProductSpace {
  const normalized = question.normalize("NFKC").trim().toLocaleLowerCase("ko-KR");
  return intentTerms.find(({ terms }) => terms.some((term) => normalized.includes(term)))?.space
    ?? "T1";
}
