import type { RadarEntry, RadarReport } from "./radar-types";

export type CreatorClaim = {
  claim_id: string;
  text: string;
  metric: string;
  value: number;
};

export type CreatorTopic = {
  candidate_id: string;
  radar_rank: number;
  champion_id: string;
  role: string;
  title_candidates: string[];
  thumbnail_copy: string[];
  hook: string;
  approved_claims: CreatorClaim[];
  counterpoint: string;
  falsifiers: Array<{ metric: string; condition: string }>;
  chapter_outline: Array<{ chapter: string; uses: string[] }>;
  data_cards: Array<{ card: string; current?: number; prior?: number; values?: unknown[] }>;
  short_summary: string;
  quality_flags: string[];
  evidence_event_ids: string[];
  review_state: "HUMAN_REVIEW_REQUIRED";
};

export type CreatorBrief = {
  schema_version: "1";
  mode: "CREATOR";
  template_version: string;
  human_review_required: true;
  publication_ready: false;
  source_snapshot: {
    radar_schema_version: "1";
    cutoff: string;
    patch_id: string;
    fixture_only: boolean;
    source_versions: Array<{ source_id: string; source_version: string; content_hash: string }>;
  };
  warnings?: string[];
  narrative_constraints: string[];
  topic_candidates: CreatorTopic[];
};

export type StoryboardScene = {
  index: number;
  chapter: "HOOK" | "WHAT CHANGED" | "WHY IT MAY MATTER" | "COUNTERPOINT" | "TAKEAWAY";
  label: string;
  timecode: string;
  duration_seconds: number;
  title: string;
  voiceover: string;
  on_screen: string;
  visual_direction: string;
  claim_ids: string[];
};

export type CreatorStoryboard = {
  schema_version: "1";
  artifact_type: "creator-storyboard";
  template_version: "creator-storyboard-v1";
  patch_id: string;
  cutoff: string;
  candidate_id: string;
  champion_id: string;
  role: string;
  radar_rank: number;
  title: string;
  title_candidates: string[];
  thumbnail_copy: string[];
  estimated_duration_seconds: number;
  scenes: StoryboardScene[];
  short_form_script: string;
  source_event_ids: string[];
  source_versions: CreatorBrief["source_snapshot"]["source_versions"];
  quality_flags: string[];
  review_state: "HUMAN_REVIEW_REQUIRED";
  publication_ready: false;
  boundary: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isCreatorBrief(value: unknown): value is CreatorBrief {
  if (!isRecord(value) || value.schema_version !== "1" || value.mode !== "CREATOR") return false;
  if (value.human_review_required !== true || value.publication_ready !== false) return false;
  if (!isRecord(value.source_snapshot) || typeof value.source_snapshot.patch_id !== "string" || typeof value.source_snapshot.cutoff !== "string") return false;
  if (!Array.isArray(value.topic_candidates) || !Array.isArray(value.narrative_constraints)) return false;
  return value.topic_candidates.every((topic) => isRecord(topic)
    && typeof topic.candidate_id === "string"
    && typeof topic.champion_id === "string"
    && typeof topic.role === "string"
    && Array.isArray(topic.title_candidates)
    && topic.title_candidates.every((title) => typeof title === "string")
    && Array.isArray(topic.approved_claims)
    && topic.approved_claims.every((claim) => isRecord(claim) && typeof claim.claim_id === "string" && typeof claim.text === "string" && typeof claim.value === "number")
    && typeof topic.counterpoint === "string"
    && Array.isArray(topic.evidence_event_ids)
    && topic.evidence_event_ids.every((eventId) => typeof eventId === "string")
    && topic.review_state === "HUMAN_REVIEW_REQUIRED");
}

function points(value: number) {
  const amount = value * 100;
  return `${amount > 0 ? "+" : amount < 0 ? "−" : ""}${Math.abs(amount).toFixed(1)}pp`;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildFallbackCreatorTopic(report: RadarReport, entry: RadarEntry): CreatorTopic {
  const candidateId = `${entry.champion_id}:${entry.role}`;
  const claims: CreatorClaim[] = [
    {
      claim_id: `${candidateId}:pick-presence`,
      metric: "pick_presence_delta",
      value: entry.metrics.pick_presence_delta,
      text: `최근 ${report.windows.recent.days}일 ${entry.champion_id} ${entry.role} 픽 점유율은 ${percent(entry.metrics.current_pick_presence)}이며 이전 구간 대비 ${points(entry.metrics.pick_presence_delta)} 변했다.`,
    },
    {
      claim_id: `${candidateId}:team-demand`,
      metric: "demand_velocity",
      value: entry.metrics.demand_velocity,
      text: `최근 채택 팀은 ${entry.metrics.current_distinct_team_count}개이며 팀 수요는 이전 구간 대비 ${points(entry.metrics.demand_velocity)} 변했다.`,
    },
  ];
  if (entry.metrics.most_divergent_region && entry.metrics.most_divergent_region_delta !== null) {
    claims.push({
      claim_id: `${candidateId}:regional-divergence`,
      metric: "most_divergent_region_delta",
      value: entry.metrics.most_divergent_region_delta,
      text: `${entry.metrics.most_divergent_region}의 최근 픽 점유율은 글로벌 점유율과 ${points(entry.metrics.most_divergent_region_delta)} 차이가 난다.`,
    });
  }
  const counterpoint = entry.metrics.current_pick_count < 3
    ? `최근 근거가 ${entry.metrics.current_pick_count}경기에 불과해 다음 스냅샷에서 재확인이 필요하다.`
    : "관측된 채택 변화만으로 챔피언의 강함, 승리 기여, 인과관계를 증명할 수 없다.";
  return {
    candidate_id: candidateId,
    radar_rank: entry.rank,
    champion_id: entry.champion_id,
    role: entry.role,
    title_candidates: [
      `왜 지금 ${entry.champion_id} ${entry.role}인가: ${points(entry.metrics.pick_presence_delta)} 변화의 근거`,
      `${entry.champion_id} ${entry.role}은 진짜 신호일까? 데이터와 반론`,
    ],
    thumbnail_copy: [`${entry.champion_id} ${entry.role}`, points(entry.metrics.pick_presence_delta)],
    hook: `${entry.champion_id} ${entry.role}의 픽 점유율과 채택 팀 수가 같은 구간에서 움직였습니다. 이 신호가 검토할 가치가 있는지 근거와 반론을 함께 보겠습니다.`,
    approved_claims: claims,
    counterpoint,
    falsifiers: [
      { metric: "demand_velocity", condition: "next comparable snapshot is less than or equal to zero" },
      { metric: "current_distinct_team_count", condition: "adoption does not expand beyond the currently observed teams" },
    ],
    chapter_outline: [
      { chapter: "HOOK", uses: [claims[0].claim_id] },
      { chapter: "WHAT CHANGED", uses: claims.map((claim) => claim.claim_id) },
      { chapter: "WHY IT MAY MATTER", uses: [claims[1].claim_id] },
      { chapter: "COUNTERPOINT", uses: [] },
      { chapter: "TAKEAWAY AND NEXT CHECK", uses: [] },
    ],
    data_cards: [
      { card: "PICK_PRESENCE_COMPARISON", current: entry.metrics.current_pick_presence, prior: entry.metrics.prior_pick_presence },
      { card: "TEAM_DEMAND_COMPARISON", current: entry.metrics.current_demand, prior: entry.metrics.prior_demand },
      { card: "REGIONAL_PRESENCE", values: entry.region_presence },
    ],
    short_summary: `${claims[0].text} 다만 ${counterpoint}`,
    quality_flags: [...entry.quality_flags],
    evidence_event_ids: [...entry.evidence_event_ids],
    review_state: "HUMAN_REVIEW_REQUIRED",
  };
}

function sceneTimecode(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function buildCreatorStoryboard(
  report: RadarReport,
  topic: CreatorTopic,
  selectedTitle = topic.title_candidates[0],
  sourceVersions: CreatorStoryboard["source_versions"] = [],
): CreatorStoryboard {
  const claims = topic.approved_claims;
  if (claims.length < 2) throw new Error("creator storyboard requires at least two approved claims");
  const title = topic.title_candidates.includes(selectedTitle) ? selectedTitle : topic.title_candidates[0];
  const allClaimIds = claims.map((claim) => claim.claim_id);
  const targetTeamClaim = claims.find((claim) => claim.metric === "target_team_public_game_rate");
  const visualCards = topic.data_cards.map((card) => card.card).join(" · ");
  const nextCheck = targetTeamClaim
    ? "다음 비교 스냅샷에서 글로벌 팀 수요가 이어지는지와 다음 T1 공개 경기에서 같은 픽이 다시 관측되는지를 각각 확인합니다."
    : "다음 비교 스냅샷에서 팀 수요가 이어지는지, 관측 팀 밖으로 채택이 확장되는지 다시 확인합니다.";
  const sceneInputs: Array<Omit<StoryboardScene, "index" | "timecode"> & { start: number }> = [
    {
      start: 0,
      chapter: "HOOK",
      label: "시작 질문",
      duration_seconds: 20,
      title: `${topic.champion_id}, 왜 지금인가?`,
      voiceover: topic.hook,
      on_screen: topic.thumbnail_copy.join(" · "),
      visual_direction: "챔피언 스플래시와 핵심 변화 수치를 한 화면에 배치",
      claim_ids: [claims[0].claim_id],
    },
    {
      start: 20,
      chapter: "WHAT CHANGED",
      label: "숫자 근거",
      duration_seconds: 75,
      title: "무엇이 달라졌나",
      voiceover: claims.map((claim) => claim.text).join(" "),
      on_screen: claims.map((claim) => claim.text).join("\n"),
      visual_direction: visualCards || "승인된 지표 비교 카드",
      claim_ids: allClaimIds,
    },
    {
      start: 95,
      chapter: "WHY IT MAY MATTER",
      label: "검토 가치",
      duration_seconds: 85,
      title: "왜 검토할 가치가 있나",
      voiceover: `${claims[1].text}${targetTeamClaim ? ` ${targetTeamClaim.text}` : ""} 이것은 강함의 증명이 아니라, 팀 검토 목록에서 빠뜨리지 않을 이유입니다.`,
      on_screen: [claims[1].text, targetTeamClaim?.text].filter(Boolean).join("\n"),
      visual_direction: "채택 팀 변화와 지역별 차이를 순서대로 강조",
      claim_ids: [claims[1].claim_id, ...(claims[2] ? [claims[2].claim_id] : []), ...(targetTeamClaim ? [targetTeamClaim.claim_id] : [])],
    },
    {
      start: 180,
      chapter: "COUNTERPOINT",
      label: "반론",
      duration_seconds: 60,
      title: "그래도 단정할 수 없는 이유",
      voiceover: topic.counterpoint,
      on_screen: topic.counterpoint,
      visual_direction: "표본과 인과관계 경고를 데이터 카드와 같은 비중으로 표시",
      claim_ids: [],
    },
    {
      start: 240,
      chapter: "TAKEAWAY",
      label: "결론과 다음 확인",
      duration_seconds: 60,
      title: "결론은 픽 추천이 아니라 재검토",
      voiceover: `현재 결론은 자동 픽 추천이 아닙니다. ${nextCheck}`,
      on_screen: nextCheck,
      visual_direction: "다음 관측 체크리스트와 출처 수를 함께 표시",
      claim_ids: [],
    },
  ];
  const scenes = sceneInputs.map(({ start, ...scene }, index) => ({
    ...scene,
    index: index + 1,
    timecode: sceneTimecode(start),
  }));
  return {
    schema_version: "1",
    artifact_type: "creator-storyboard",
    template_version: "creator-storyboard-v1",
    patch_id: report.patch_id,
    cutoff: report.cutoff,
    candidate_id: topic.candidate_id,
    champion_id: topic.champion_id,
    role: topic.role,
    radar_rank: topic.radar_rank,
    title,
    title_candidates: [...topic.title_candidates],
    thumbnail_copy: [...topic.thumbnail_copy],
    estimated_duration_seconds: scenes.reduce((total, scene) => total + scene.duration_seconds, 0),
    scenes,
    short_form_script: `${topic.hook} ${claims[0].text} ${claims[1].text}${targetTeamClaim ? ` ${targetTeamClaim.text}` : ""} 다만 ${topic.counterpoint} 다음 스냅샷에서 같은 신호가 이어지는지 다시 확인하겠습니다.`,
    source_event_ids: [...topic.evidence_event_ids],
    source_versions: [...sourceVersions],
    quality_flags: [...topic.quality_flags],
    review_state: "HUMAN_REVIEW_REQUIRED",
    publication_ready: false,
    boundary: "공개 경기에서 승인된 주장만 배열한 제작 초안입니다. 사람의 사실 확인과 편집 승인 전에는 발행할 수 없습니다.",
  };
}

export function creatorStoryboardMarkdown(storyboard: CreatorStoryboard) {
  const scenes = storyboard.scenes.map((scene) => [
    `## ${scene.timecode} · ${scene.label}`,
    "",
    `**화면:** ${scene.title}`,
    "",
    scene.voiceover,
    "",
    `- 시각 자료: ${scene.visual_direction}`,
    `- 근거 주장: ${scene.claim_ids.length ? scene.claim_ids.join(", ") : "반론/검토 경계"}`,
  ].join("\n")).join("\n\n");
  return [
    `# ${storyboard.title}`,
    "",
    `- 후보: ${storyboard.champion_id} ${storyboard.role}`,
    `- 패치: ${storyboard.patch_id}`,
    `- 검토 상태: ${storyboard.review_state}`,
    `- 썸네일: ${storyboard.thumbnail_copy.join(" / ")}`,
    `- 예상 길이: ${Math.round(storyboard.estimated_duration_seconds / 60)}분`,
    "",
    scenes,
    "",
    "## 쇼츠 대본",
    "",
    storyboard.short_form_script,
    "",
    "## 원본 근거",
    "",
    ...storyboard.source_event_ids.map((eventId) => `- ${eventId}`),
    "",
    `> ${storyboard.boundary}`,
    "",
  ].join("\n");
}
