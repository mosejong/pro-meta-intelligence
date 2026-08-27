import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const templateRoot = new URL("../", import.meta.url);

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`https://meta-radar.example${path}`, {
      headers: { accept: "text/html", host: "meta-radar.example" },
    }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the onboarding home as a focused product entry", async () => {
  const response = await render();
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /T1, 오늘/);
  assert.match(html, /뭐부터 볼까/);
  assert.match(html, /오늘은 이것만 먼저 보세요/);
  assert.match(html, /다음 공식 일정/);
  assert.match(html, /T1 공개 경기 반복 픽/);
  assert.match(html, /이번 패치 주목 후보/);
  assert.match(html, /무엇이 궁금하세요/);
  assert.match(html, /입력 내용은 저장하거나 서버로 보내지 않습니다/);
  assert.match(html, /AI 검증 전 · 자동 판단 안 함/);
  assert.match(html, /규칙 기반 분석/);
  assert.match(html, /하고 싶은 일 하나만 고르세요/);
  assert.match(html, /데이터 최신성과 일정 신뢰 상태/);
  assert.match(html, /데이터 확인 중/);
  assert.match(html, /공식 일정 확인 중/);
  assert.match(html, /미확정 상대·오래된 일정은 우선순위에서 자동 제외합니다/);
  assert.match(html, /어떻게 판단했나요/);
  assert.match(html, /href="\.\/team\/"/);
  assert.match(html, /href="\.\/t1\/"/);
  assert.match(html, /href="\.\/creator\/"/);
  assert.match(html, /href="\.\/radar\/"/);
  assert.doesNotMatch(html, /chatgpt|openai|gpt login|sign in/i);
});

test("server-renders the team analyst surface", async () => {
  const response = await render("/team");
  const styles = await readFile(new URL("app/globals.css", templateRoot), "utf8");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>팀 분석 · Pro Meta Intelligence<\/title>/i);
  assert.match(html, /TEAM ROOM/);
  assert.match(html, /내 팀 기준으로 결정하세요/);
  assert.match(html, /REKSAI/i);
  assert.match(html, /PUBLIC TEAM EVIDENCE/);
  assert.match(html, /오늘 팀이/);
  assert.match(html, /결정할 3가지/);
  assert.match(html, /LIVE DECISION QUEUE/);
  assert.match(html, /티어표가 아니라 회의 시작점입니다/);
  assert.match(html, /<main class="section-space space-team quick-view">/);
  assert.match(html, /처음이라면 여기만/);
  assert.match(html, /세 줄로 먼저 이해하세요/);
  assert.match(html, /01 · 한 줄 결론/);
  assert.match(html, /02 · 왜 중요한가/);
  assert.match(html, /03 · 확인한 근거/);
  assert.match(html, /먼저 내 팀을 선택하세요/);
  assert.match(html, /용어가 어렵다면 20초 설명 보기/);
  assert.match(html, /좋다고 확정한 픽이 아니라 먼저 검토할 픽/);
  assert.match(html, /전체 근거 보기/);
  assert.match(html, /데이터 최신성과 일정 신뢰 상태/);
  assert.match(html, /분석 데이터/);
  assert.match(html, /공식 일정/);
  assert.match(html, /자동 보호/);
  assert.match(html, /10-SECOND START/);
  assert.match(html, /원하는 결과부터 고르세요/);
  assert.match(html, /T1 다음 경기/);
  assert.match(html, /내 팀 vs T1/);
  assert.match(html, /영상 아이템 만들기/);
  assert.match(html, /3개 공개 팀 중 하나를 고르면/);
  assert.match(html, /핵심만 표시 중/);
  assert.match(html, /전체 분석 보기/);
  assert.match(html, /분석 링크 복사/);
  assert.match(html, /내 팀 선택 후 공유 가능/);
  assert.match(html, /PLAYER LENS · PUBLIC \+ PRIVATE/);
  assert.match(html, /선수 성향과 개인 연습을 섞지 않고 봅니다/);
  assert.match(html, /개인 연습 세션 오버레이/);
  assert.match(html, /PRIVATE DATA BOUNDARY/);
  assert.match(html, /서버·로컬 저장소·AI·발행 피드로 전송하지 않습니다/);
  assert.match(html, /상대팀 연습 데이터 금지/);
  assert.match(html, /ONE-PAGE · STAFF REVIEW/);
  assert.match(html, /T1 공개 데이터 원페이지 브리프/);
  assert.match(html, /NEXT VERIFIED FIXTURE/);
  assert.match(html, /DECIDE IN MEETING/);
  assert.match(html, /NO VERIFIED HEAD-TO-HEAD YET/);
  assert.match(html, /상대 확정 전에는 라인 저격 자료를 만들지 않습니다/);
  assert.match(html, /href="#t1-brief"/);
  assert.match(html, /전체 메타 신호 탐색/);
  assert.match(styles, /\.quick-view \.audit-notice[^\n]+\.quick-view \.method[^\n]+display: none/);
  assert.doesNotMatch(styles, /\.quick-view[^\n]+\.workspace/);
  assert.match(styles, /\.quick-start-grid/);
  assert.match(styles, /body\.print-t1-one-page main > :not\(\.t1-one-page\)/);
  assert.match(html, /TEAM DECISION BRIEF/);
  assert.match(html, /오늘 코칭스태프가 검토할 5가지/);
  assert.match(html, /반대 근거/);
  assert.match(html, /스크림 질문/);
  assert.match(html, /중단 조건/);
  assert.match(html, /우선 검토/);
  assert.match(html, /팀 데이터 경계/);
  assert.match(html, /인쇄 \/ PDF/);
  assert.match(html, /JSON 내보내기/);
  assert.match(html, /출전 권고가 아닙니다/);
  assert.match(html, /HUMAN DECISION · DEVICE LOCAL/);
  assert.match(html, /이 후보를 어떻게 처리할지 기록/);
  assert.match(html, /검토 대기/);
  assert.match(html, /검토 완료/);
  assert.match(html, /테스트 요청/);
  assert.match(html, /채택/);
  assert.match(html, /기각/);
  assert.match(html, /계속 추적/);
  assert.match(html, /비민감 회의 메모/);
  assert.match(html, /JOURNAL JSON/);
  assert.match(html, /현재 브라우저에만 저장/);
  assert.match(html, /WALK-FORWARD OUTCOME/);
  assert.match(html, /먼저 사람의 판단을 기록하세요/);
  assert.match(html, /사후 결과는 사람의 상태를 자동 변경하지 않습니다/);
  assert.match(html, /T1 TARGET DESK/);
  assert.match(html, /T1 공략 준비실/);
  assert.match(html, /T1 분석 바로가기/);
  assert.match(html, /T1 기본 타깃/);
  assert.match(html, /T1 TARGET PROFILE/);
  assert.match(html, /T1 MATCH-DAY CONTROL/);
  assert.match(html, /다음 T1 일정과 준비 상태/);
  assert.match(html, /MATCH-DAY JSON/);
  assert.match(html, /5-LANE REPORT ARMED/);
  assert.match(html, /상대 확정 시 라인별 충돌 보고서 자동 생성/);
  assert.match(html, /WAITING FOR VERIFIED OPPONENT/);
  assert.match(html, /CHANGE LOG UNAVAILABLE/);
  assert.match(html, /T1의 이번 패치에서 바뀐 것/);
  assert.match(html, /최근 관측 라인업의 챔피언 풀/);
  assert.match(html, /최근 경기 타임라인/);
  assert.match(html, /T1 프로필 JSON/);
  assert.match(html, /MY TEAM LENS/);
  assert.match(html, /STEP 1 · MY TEAM LENS/);
  assert.match(html, /팀명 또는 리그 검색/);
  assert.match(html, /예: T1, LCK, G2/);
  assert.match(html, /전체 \d+개 팀/);
  assert.match(html, /팀 분석 진행 단계/);
  assert.match(html, /드래프트 배틀카드/);
  assert.match(html, /공식 일정 연결 중/);
  assert.match(html, /OPPONENT PRIORITY QUEUE|STEP 01/);
  assert.match(html, /DRAFT BATTLECARD/);
  assert.match(html, /보호 자원 · 픽 충돌 · 견제 검토 · 교환 시나리오/);
  assert.match(html, /선수 숙련도 · 스크림 · 내부 밴픽 계획은 추정하지 않음/);
  assert.match(html, /원본 상대 통계/);
  assert.match(html, /상대 검색/);
  assert.match(html, /개 상대 · T1 기본 타깃 · 점수순/);
  assert.match(html, /픽·밴·사이드·로테이션 상세는 필요할 때만 펼쳐보세요/);
  assert.match(html, /모바일 빠른 이동/);
  assert.match(html, /HISTORY · WALK-FORWARD/);
  assert.match(html, /실데이터 검증 준비도/);
  assert.match(html, /일일 수집 계속/);
  assert.match(html, /10(?:<!-- -->)?% 축적/);
  assert.match(html, /COLLECTION CONTINUITY/);
  assert.match(html, /연속 수집 정상/);
  assert.match(html, /EARLIEST POSSIBLE/);
  assert.match(html, /보장 날짜가 아닙니다/);
  assert.match(html, /EVIDENCE REMAINING/);
  assert.match(html, /CREATOR EXPORT LAB/);
  assert.match(html, /분석을 바로 영상 장면으로/);
  assert.match(html, /16:9 유튜브/);
  assert.match(html, /9:16 쇼츠/);
  assert.match(html, /PNG 저장/);
  assert.match(html, /CANVAS FALLBACK READY/);
  assert.match(html, /3분 브리프/);
  assert.match(html, /T1 공략 준비실/);
  assert.match(html, /상대가 한 밴/);
  assert.match(html, /상대가 받은 밴/);
  assert.match(html, /회의에서 확인할 질문/);
  assert.match(html, /Seoul Phoenix/);
  assert.match(html, /meta-radar-hero-v2\.png/);
  assert.match(html, /cdn\/16\.16\.1\/img\/champion\/RekSai\.png/);
  assert.match(html, /cdn\/16\.16\.1\/img\/champion\/DrMundo\.png/);
  assert.match(html, /JSON 불러오기/);
  assert.match(html, /FEED CONNECTING/);
  assert.match(html, /isn&#x27;t endorsed by Riot Games/i);
  assert.match(html, /https:\/\/meta-radar\.example\/meta-radar-hero-v2\.png/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
  assert.ok(html.indexOf('class="decision-hero"') < html.indexOf('class="team-brief"'));
  assert.ok(html.indexOf('class="team-lens setup"') < html.indexOf('class="team-brief"'));
  assert.ok(html.indexOf('class="team-lens setup"') < html.indexOf('class="decision-flow"'));
  assert.ok(html.indexOf('class="decision-flow"') < html.indexOf('class="t1-one-page"'));
  assert.ok(html.indexOf('class="t1-one-page"') < html.indexOf('class="team-brief"'));
  assert.ok(html.indexOf('class="decision-flow"') < html.indexOf('class="team-brief"'));
  assert.ok(html.indexOf('class="team-brief"') < html.indexOf('class="history-readiness'));
  assert.ok(html.indexOf('class="history-readiness') < html.indexOf('class="opponent-prep"'));
  assert.ok(html.indexOf('class="opponent-prep"') < html.indexOf('class="creator-export"'));
  assert.ok(html.indexOf('class="creator-export"') < html.indexOf('class="workspace"'));
});

test("server-renders every focused workspace route", async () => {
  const cases = [
    ["/t1", "space-t1", "T1 DESK", "T1 한 장 요약 보기"],
    ["/creator", "space-creator", "CREATOR STUDIO", "영상 장면 만들기"],
    ["/radar", "space-radar", "META RADAR", "후보와 근거 보기"],
  ];

  for (const [path, className, marker, guideAction] of cases) {
    const response = await render(path);
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, new RegExp(`<main class="section-space ${className} quick-view">`));
    assert.match(html, new RegExp(marker));
    assert.match(html, /세 줄로 먼저 이해하세요/);
    assert.match(html, new RegExp(guideAction));
  }
});

test("server-renders a five-scene creator workflow with human review", async () => {
  const response = await render("/creator");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /STORYBOARD V1 · CLAIM LOCKED/);
  assert.match(html, /한 후보를 영상 한 편으로/);
  assert.match(html, /Hook → 근거 → 의미 → 반론 → 다음 확인/);
  assert.match(html, /영상 장면 순서/);
  assert.match(html, /SHORTS · 30–60 SEC/);
  assert.match(html, /HUMAN REVIEW GATE/);
  assert.match(html, /대본 Markdown/);
  assert.match(html, /스토리보드 JSON/);
  assert.match(html, /검토 전 · 발행 불가/);
  assert.match(html, /T1-FIRST CREATOR ANGLE/);
  assert.match(html, /실제 공개 중복만 T1과 연결합니다/);
  assert.match(html, /T1 공개 중복/);
  assert.match(html, /글로벌 Radar/);
  assert.match(html, /STEP 1 · HUMAN BASELINE/);
  assert.match(html, /AI와 비교할 사람 기준선부터 모으기/);
  assert.match(html, /아직 AI 평가에 포함되지 않음/);
  assert.match(html, /기기 로컬 기록을 확인하는 중/);
});

test("keeps human AI baselines local, bounded, and explicitly ungraded", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const entry = feed.entries.find((item) => item.evidence_event_ids.length > 0);
  assert.ok(entry);
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const {
      createAIHumanBaselineDraft,
      exportAIHumanBaselineBundle,
      parseAIHumanBaselineDrafts,
      serializeAIHumanBaselineDrafts,
      upsertAIHumanBaselineDraft,
    } = await vite.ssrLoadModule("/app/ai-human-baseline.ts");
    const first = createAIHumanBaselineDraft({
      report: feed,
      entry,
      draftId: "draft-001",
      savedAt: "2026-08-26T08:00:00Z",
      claimIds: ["CLAIM:OBSERVED_GROWTH", "CLAIM:INVENTED"],
      evidenceIds: [entry.evidence_event_ids[0], "EVENT:INVENTED"],
      boundaryIds: ["BOUNDARY:PUBLIC_ONLY", "BOUNDARY:INVENTED"],
      criticalErrorIds: ["CRITICAL:INVENTED"],
      durationSeconds: 48.4,
      acceptedWithoutEdit: true,
    });
    assert.equal(first.status, "HUMAN_BASELINE_ONLY");
    assert.deepEqual(first.human.claim_ids, ["CLAIM:OBSERVED_GROWTH"]);
    assert.deepEqual(first.human.evidence_ids, [entry.evidence_event_ids[0]]);
    assert.deepEqual(first.human.boundary_ids, ["BOUNDARY:PUBLIC_ONLY"]);
    assert.deepEqual(first.human.critical_error_ids, []);
    assert.equal(first.human.duration_seconds, 48);
    assert.ok(first.task.available_evidence_ids.length <= 12);
    assert.deepEqual(first.task.available_claim_ids, [
      "CLAIM:OBSERVED_GROWTH",
      "CLAIM:MULTI_TEAM_ADOPTION",
      "CLAIM:REGIONAL_DIVERGENCE",
      "CLAIM:CONCENTRATED_SIGNAL",
      "CLAIM:INSUFFICIENT_SAMPLE",
      "CLAIM:COUNTERPOINT_REQUIRED",
    ]);
    assert.equal(first.privacy.analyst_identity_collected, false);
    assert.equal(first.privacy.api_key_collected, false);

    const replacement = { ...first, draft_id: "draft-002", saved_at: "2026-08-26T08:01:00Z" };
    const drafts = upsertAIHumanBaselineDraft([first], replacement);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].draft_id, "draft-002");
    assert.deepEqual(parseAIHumanBaselineDrafts(serializeAIHumanBaselineDrafts(drafts)), drafts);
    assert.deepEqual(parseAIHumanBaselineDrafts("{not-json"), []);

    const bundle = JSON.parse(exportAIHumanBaselineBundle(drafts, "2026-08-26T08:02:00Z"));
    assert.equal(bundle.case_count, 1);
    assert.equal(bundle.contains_expert_reference, false);
    assert.equal(bundle.contains_ai_output, false);
    assert.equal(bundle.ready_for_release_evaluation, false);
    assert.equal(bundle.next_action, "ADD_SEALED_REFERENCE_AND_PAIRED_AI_OUTPUT_OFFLINE");
  } finally {
    await vite.close();
  }
});

test("keeps human team decisions snapshot-scoped and validates local journal data", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  assert.ok(t1);
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildTeamBrief } = await vite.ssrLoadModule("/app/team-brief.ts");
    const {
      createDecisionJournalEntry,
      decisionJournalId,
      MAX_DECISION_JOURNAL_ENTRIES,
      parseDecisionJournal,
      serializeDecisionJournal,
      upsertDecisionJournalEntry,
    } = await vite.ssrLoadModule("/app/decision-journal.ts");
    const card = buildTeamBrief(feed)[0];
    assert.ok(card);
    assert.notEqual(decisionJournalId(feed, card), decisionJournalId(feed, card, t1));

    const created = createDecisionJournalEntry(
      feed,
      card,
      t1,
      "SCRIM_REQUESTED",
      ` 공개 근거만 확인 ${"x".repeat(300)} `,
      "2026-08-25T10:00:00.000Z",
    );
    assert.equal(created.own_team.team_name, "T1");
    assert.equal(created.human_state, "SCRIM_REQUESTED");
    assert.equal(created.analyst_note.length, 280);
    assert.deepEqual(created.evidence_event_ids, [...new Set(card.entry.evidence_event_ids)].sort());
    assert.deepEqual(created.source_versions, feed.evidence_index.source_versions);

    const adopted = createDecisionJournalEntry(
      feed,
      card,
      t1,
      "ADOPTED",
      "공개 근거 검토 완료",
      "2026-08-25T11:00:00.000Z",
      created,
    );
    assert.equal(adopted.created_at, created.created_at);
    assert.equal(adopted.updated_at, "2026-08-25T11:00:00.000Z");
    const stored = upsertDecisionJournalEntry([created], adopted);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].human_state, "ADOPTED");

    const serialized = serializeDecisionJournal(stored, "2026-08-25T12:00:00.000Z");
    const bundle = JSON.parse(serialized);
    assert.equal(bundle.storage_scope, "DEVICE_LOCAL");
    assert.match(bundle.boundary, /No server sync/);
    assert.deepEqual(parseDecisionJournal(serialized), stored);
    assert.deepEqual(parseDecisionJournal("not-json"), []);
    bundle.entries[0].human_state = "UNVERIFIED_PRIVATE_RESULT";
    assert.deepEqual(parseDecisionJournal(JSON.stringify(bundle)), []);
    const oversized = Array.from({ length: MAX_DECISION_JOURNAL_ENTRIES + 5 }, (_, index) => ({
      ...adopted,
      decision_id: `${adopted.decision_id}:${index}`,
      updated_at: `2026-08-25T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
    }));
    assert.equal(upsertDecisionJournalEntry(oversized, adopted).length, MAX_DECISION_JOURNAL_ENTRIES);
  } finally {
    await vite.close();
  }
});

test("reconciles journal decisions only to exact or immutable source-state outcomes", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildTeamBrief } = await vite.ssrLoadModule("/app/team-brief.ts");
    const { createDecisionJournalEntry } = await vite.ssrLoadModule("/app/decision-journal.ts");
    const { isDecisionOutcomesFeed, reconcileDecisionOutcome } = await vite.ssrLoadModule("/app/decision-outcomes.ts");
    const card = buildTeamBrief(feed)[0];
    const entry = createDecisionJournalEntry(feed, card, t1, "REVIEWED", "공개 근거 확인", feed.cutoff);
    const candidate = {
      champion_id: entry.candidate.champion_id,
      role: entry.candidate.role,
      radar_rank: entry.candidate.radar_rank,
      outcome: "HIT",
      candidate_evidence_event_ids: entry.evidence_event_ids,
      pre_cutoff: { pick_presence: 0.02, pick_presence_delta: 0.01, demand_velocity: 0.05 },
      confirmed_at: "2026-08-26T12:00:00+00:00",
      future_pick_count: 3,
      future_distinct_team_count: 2,
      outcome_match_ids: ["match:1", "match:2"],
      outcome_event_ids: ["event:1", "event:2"],
    };
    const evaluation = {
      evaluation_id: `${feed.patch_id}::${feed.cutoff}`,
      cutoff: feed.cutoff,
      outcome_end: "2026-09-01T00:00:00+00:00",
      patch_id: feed.patch_id,
      selected_candidates: [candidate],
      missed_adoptions: [],
      source_versions: feed.evidence_index.source_versions,
    };
    const outcomes = {
      schema_version: "1",
      artifact_type: "team-decision-outcomes",
      as_of: "2026-09-02T00:00:00+00:00",
      status: "COMPLETE",
      benchmark_ready: true,
      summary: {
        evaluated_cutoff_count: 1,
        selected_candidate_count: 1,
        hit_count: 1,
        false_alert_count: 0,
        missed_adoption_count: 0,
      },
      evaluations: [evaluation],
    };
    assert.equal(isDecisionOutcomesFeed(outcomes), true);
    assert.equal(reconcileDecisionOutcome(entry, outcomes).status, "HIT");
    assert.equal(reconcileDecisionOutcome(entry, outcomes).match, "EXACT_CUTOFF");

    const sourceStateOutcomes = {
      ...outcomes,
      evaluations: [{ ...evaluation, evaluation_id: "earlier", cutoff: "2026-08-24T00:00:00+00:00" }],
    };
    assert.equal(reconcileDecisionOutcome(entry, sourceStateOutcomes).match, "SOURCE_STATE");
    const unrelated = {
      ...sourceStateOutcomes,
      evaluations: [{
        ...sourceStateOutcomes.evaluations[0],
        source_versions: [{
          source_id: "oracles-elixir-match-data",
          source_version: `sha256:${"b".repeat(64)}`,
          content_hash: `sha256:${"b".repeat(64)}`,
        }],
      }],
    };
    assert.equal(reconcileDecisionOutcome(entry, unrelated).status, "WAITING_FOR_CUTOFF");
    assert.equal(reconcileDecisionOutcome(undefined, outcomes).status, "NOT_RECORDED");
  } finally {
    await vite.close();
  }
});

test("builds deterministic creator scenes for YouTube and Shorts exports", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const entry = feed.entries.find((item) => item.eligible_for_review);
  assert.ok(entry);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildCreatorScene, creatorCanvasSize } = await vite.ssrLoadModule("/app/creator-export.tsx");
    const landscape = buildCreatorScene(feed, entry, "landscape");
    const vertical = buildCreatorScene(feed, entry, "vertical");

    assert.deepEqual(creatorCanvasSize("landscape"), { width: 1280, height: 720 });
    assert.deepEqual(creatorCanvasSize("vertical"), { width: 1080, height: 1920 });
    assert.equal(landscape.artifact_type, "creator-visual-scene");
    assert.equal(landscape.aspect, "landscape");
    assert.equal(vertical.aspect, "vertical");
    assert.equal(landscape.champion_id, entry.champion_id);
    assert.deepEqual(landscape.source_event_ids, entry.evidence_event_ids);
    assert.equal(landscape.source_count, entry.evidence_event_ids.length);
    assert.equal(landscape.evidence.length, 4);
    assert.match(landscape.title, /왜 .* 지금 봐야 하나/);
    assert.match(landscape.counterpoint, /공개 경기|집중|편차|품질 경고/);
    assert.match(landscape.image_url, /^https:\/\/ddragon\.leagueoflegends\.com\/cdn\/img\/champion\/splash\//);
    assert.match(landscape.boundary, /출전 권고가 아닙니다/);
  } finally {
    await vite.close();
  }
});

test("builds a claim-locked five-scene storyboard from the published creator brief", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const brief = JSON.parse(await readFile(new URL("public/feed/current-creator.json", templateRoot), "utf8"));
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildCreatorStoryboard, creatorStoryboardMarkdown, isCreatorBrief } = await vite.ssrLoadModule("/app/creator-storyboard.ts");
    assert.equal(isCreatorBrief(brief), true);
    assert.equal(isCreatorBrief({ ...brief, publication_ready: true }), false);
    assert.equal(brief.source_snapshot.patch_id, feed.patch_id);
    assert.equal(brief.source_snapshot.cutoff, feed.cutoff);

    const topic = brief.topic_candidates[0];
    const storyboard = buildCreatorStoryboard(feed, topic, topic.title_candidates[1], brief.source_snapshot.source_versions);
    const approvedClaimIds = new Set(topic.approved_claims.map((claim) => claim.claim_id));
    assert.equal(storyboard.artifact_type, "creator-storyboard");
    assert.equal(storyboard.template_version, "creator-storyboard-v1");
    assert.equal(storyboard.title, topic.title_candidates[1]);
    assert.equal(storyboard.scenes.length, 5);
    assert.equal(storyboard.estimated_duration_seconds, 300);
    assert.deepEqual(storyboard.scenes.map((scene) => scene.timecode), ["00:00", "00:20", "01:35", "03:00", "04:00"]);
    assert.deepEqual(storyboard.scenes.map((scene) => scene.chapter), ["HOOK", "WHAT CHANGED", "WHY IT MAY MATTER", "COUNTERPOINT", "TAKEAWAY"]);
    assert.ok(storyboard.scenes.flatMap((scene) => scene.claim_ids).every((claimId) => approvedClaimIds.has(claimId)));
    assert.deepEqual(storyboard.source_event_ids, topic.evidence_event_ids);
    assert.deepEqual(storyboard.source_versions, brief.source_snapshot.source_versions);
    assert.equal(storyboard.review_state, "HUMAN_REVIEW_REQUIRED");
    assert.equal(storyboard.publication_ready, false);
    assert.match(storyboard.short_form_script, new RegExp(topic.champion_id));
    const markdown = creatorStoryboardMarkdown(storyboard);
    assert.match(markdown, /^# /);
    assert.match(markdown, /## 00:00 · 시작 질문/);
    assert.match(markdown, /## 쇼츠 대본/);
    assert.match(markdown, new RegExp(topic.evidence_event_ids[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(markdown, /HUMAN_REVIEW_REQUIRED/);
  } finally {
    await vite.close();
  }
});

test("builds T1 creator angles only from exact public pick and Radar overlaps", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildT1CreatorAngles } = await vite.ssrLoadModule("/app/creator-t1-angle.ts");
    const { buildCreatorStoryboard } = await vite.ssrLoadModule("/app/creator-storyboard.ts");
    const angles = buildT1CreatorAngles(feed);
    assert.ok(angles.length > 0);
    assert.equal(angles[0].target_team_name, "T1");
    assert.equal(angles[0].topic.champion_id, "Vi");
    assert.equal(angles[0].topic.role, "JUNGLE");
    assert.ok(angles.every((angle) => angle.angle_type === "DIRECT_PUBLIC_OVERLAP"));
    assert.ok(angles.every((angle) => angle.observed_game_count > 0));
    assert.ok(angles.every((angle) => angle.target_evidence_ids.length > 0));
    assert.ok(angles.every((angle) => angle.global_evidence_ids.length > 0));
    assert.ok(angles.every((angle) => angle.target_evidence_ids.every((eventId) => angle.topic.evidence_event_ids.includes(eventId))));
    assert.ok(angles.every((angle) => angle.topic.approved_claims.some((claim) => claim.metric === "target_team_public_game_rate")));
    assert.ok(angles.every((angle) => angle.topic.title_candidates.every((title) => title.includes("T1"))));
    assert.ok(angles.every((angle) => /스크림|의도/.test(angle.boundary)));

    const storyboard = buildCreatorStoryboard(feed, angles[0].topic);
    const targetClaim = angles[0].topic.approved_claims.find((claim) => claim.metric === "target_team_public_game_rate");
    assert.ok(targetClaim);
    assert.ok(storyboard.scenes[1].claim_ids.includes(targetClaim.claim_id));
    assert.ok(storyboard.scenes[2].claim_ids.includes(targetClaim.claim_id));
    assert.match(storyboard.short_form_script, /T1/);
    assert.match(storyboard.scenes[4].voiceover, /다음 T1 공개 경기/);

    const withoutT1Picks = {
      ...feed,
      opponent_prep: {
        ...feed.opponent_prep,
        teams: feed.opponent_prep.teams.map((team) => team.team_name === "T1" ? { ...team, priority_picks: [] } : team),
      },
    };
    assert.deepEqual(buildT1CreatorAngles(withoutT1Picks), []);
  } finally {
    await vite.close();
  }
});

test("builds a deterministic evidence-bounded match-day brief from the published feed", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  assert.ok(t1);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildEmergencyBrief } = await vite.ssrLoadModule("/app/emergency-brief.ts");
    const first = buildEmergencyBrief(feed, t1);
    const second = buildEmergencyBrief(feed, t1);

    assert.deepEqual(first, second);
    assert.equal(first.schema_version, "1");
    assert.equal(first.artifact_type, "match-day-emergency-brief");
    assert.equal(first.read_time_minutes, 3);
    assert.equal(first.opponent.team_name, "T1");
    assert.equal(first.opponent.game_count, t1.game_count);
    assert.equal(first.opponent.evidence_quality, "USABLE_WITH_LIMITS");
    assert.deepEqual(first.alerts.map((alert) => alert.type), ["PICK", "BAN", "ROTATION"]);
    assert.ok(first.meta_overlaps.length > 0);
    assert.ok(first.meta_overlaps.every((item) => item.evidence_ids.length > 0));
    assert.equal(first.patch_review_queue.length, 3);
    assert.equal(first.staff_questions.length, 4);
    assert.ok(first.unknowns.some((item) => item.includes("스크림")));
    assert.match(first.boundary, /not an automatic draft recommendation/i);
    assert.deepEqual(first.evidence.opponent_match_ids, t1.evidence.match_ids);
    assert.ok(first.evidence.source_versions.length > 0);

    const lowSample = buildEmergencyBrief(feed, {
      ...t1,
      quality_flags: ["LOW_MATCH_SAMPLE"],
    });
    const incomplete = buildEmergencyBrief(feed, {
      ...t1,
      quality_flags: ["LOW_MATCH_SAMPLE", "INCOMPLETE_BAN_EVIDENCE"],
    });
    assert.equal(lowSample.opponent.evidence_quality, "LOW_SAMPLE");
    assert.equal(incomplete.opponent.evidence_quality, "INCOMPLETE_EVIDENCE");
    assert.ok(incomplete.unknowns.some((item) => item.includes("누락")));
  } finally {
    await vite.close();
  }
});

test("ranks opponents from an explicit own-team perspective without self-matches", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  const geng = feed.opponent_prep.teams.find((team) => team.team_name === "Gen.G");
  assert.ok(t1);
  assert.ok(geng);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildTeamContext, scoreOpponent } = await vite.ssrLoadModule("/app/team-context.ts");
    const { buildEmergencyBrief } = await vite.ssrLoadModule("/app/emergency-brief.ts");
    const schedule = {
      schema_version: "1",
      artifact_type: "pro-schedule-snapshot",
      source_id: "lol-esports-schedule",
      source_url: "https://lolesports.com/en-US/leagues/lck",
      retrieved_at: "2026-08-24T00:00:00Z",
      available_at: "2026-08-24T00:00:00Z",
      content_hash: `sha256:${"a".repeat(64)}`,
      locale: "en-US",
      league_slugs: ["lck"],
      events: [{
        event_id: "lolesports:test-t1-geng",
        start_at: "2026-08-26T08:00:00Z",
        league: "LCK",
        block: "Playoffs",
        best_of: 5,
        participants: [{ name: "T1", code: "T1" }, { name: "Gen.G Esports", code: "GEN" }],
      }],
      quality: { event_count: 1, tbd_participant_count: 0 },
      boundary: "Official public schedule facts only.",
    };
    const context = buildTeamContext(feed, t1.team_id, schedule);
    assert.ok(context);
    assert.equal(context.my_team.team_name, "T1");
    assert.equal(context.opponent_priorities.length, feed.opponent_prep.teams.length - 1);
    assert.ok(context.opponent_priorities.every((item) => item.team.team_id !== t1.team_id));
    assert.equal(context.opponent_priorities[0].team.team_id, geng.team_id);
    assert.equal(context.opponent_priorities[0].next_meeting.event_id, "lolesports:test-t1-geng");

    const genGPriority = scoreOpponent(feed, t1, geng, schedule);
    assert.ok(genGPriority.shared_leagues.includes("LCK"));
    assert.equal(genGPriority.components.same_league, 30);
    assert.equal(genGPriority.components.schedule_urgency, 30);
    assert.equal(genGPriority.next_meeting.event_id, "lolesports:test-t1-geng");
    assert.equal(genGPriority.days_until_meeting, 3);
    assert.equal(genGPriority.score, Math.min(100, Object.values(genGPriority.components).reduce((sum, value) => sum + value, 0)));
    assert.match(genGPriority.reasons.join(" "), /LCK/);
    assert.match(genGPriority.reasons[0], /공식 대진/);

    const brief = buildEmergencyBrief(feed, geng, t1, schedule);
    assert.equal(brief.own_team.team_name, "T1");
    assert.equal(brief.priority_context.score, genGPriority.score);
    assert.equal(brief.priority_context.next_meeting.event_id, "lolesports:test-t1-geng");
    assert.match(brief.headline, /^T1 기준/);
    assert.ok(brief.unknowns.some((item) => item.includes("T1")));
  } finally {
    await vite.close();
  }
});

test("builds an evidence-bounded own-team draft battlecard", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  const geng = feed.opponent_prep.teams.find((team) => team.team_name === "Gen.G");
  assert.ok(t1);
  assert.ok(geng);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { scoreOpponent } = await vite.ssrLoadModule("/app/team-context.ts");
    const { buildMatchupBattlecard } = await vite.ssrLoadModule("/app/matchup-battlecard.ts");
    const priority = scoreOpponent(feed, t1, geng);
    const first = buildMatchupBattlecard(feed, t1, geng, priority);
    const second = buildMatchupBattlecard(feed, t1, geng, priority);

    assert.deepEqual(first, second);
    assert.equal(first.schema_version, "1");
    assert.equal(first.artifact_type, "public-draft-battlecard");
    assert.equal(first.own_team.team_name, "T1");
    assert.equal(first.opponent.team_name, "Gen.G");
    assert.equal(first.priority_context.score, priority.score);
    assert.equal(first.evidence_quality, "OBSERVED");
    assert.ok(first.protect.some((item) => item.champion_id === "Vi"));
    assert.ok(first.contested.some((item) => item.champion_id === "Caitlyn"));
    assert.ok(first.deny_review.length > 0);
    assert.ok(first.exchange);
    assert.ok(first.exchange.evidence_ids.length > 0);
    assert.ok([...first.protect, ...first.contested, ...first.deny_review].every((item) => item.evidence_ids.length > 0));
    assert.ok(first.unknowns.some((item) => item.includes("스크림")));
    assert.ok(first.evidence.match_ids.length >= Math.max(t1.evidence.match_ids.length, geng.evidence.match_ids.length));
    assert.ok(first.evidence.source_versions.length > 0);
    assert.match(first.boundary, /does not recommend an automatic pick or ban/i);
  } finally {
    await vite.close();
  }
});

test("builds a deterministic T1 target profile with players, patch shifts, and own-team context", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  const geng = feed.opponent_prep.teams.find((team) => team.team_name === "Gen.G");
  assert.ok(t1);
  assert.ok(geng);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { scoreOpponent } = await vite.ssrLoadModule("/app/team-context.ts");
    const { buildMatchupBattlecard } = await vite.ssrLoadModule("/app/matchup-battlecard.ts");
    const { buildTargetProfile, serializeTargetProfile } = await vite.ssrLoadModule("/app/target-profile.ts");
    const priority = scoreOpponent(feed, geng, t1);
    const battlecard = buildMatchupBattlecard(feed, geng, t1, priority);
    const first = buildTargetProfile(feed, t1, battlecard);
    const second = buildTargetProfile(feed, t1, battlecard);

    assert.deepEqual(first, second);
    assert.equal(first.artifact_type, "team-target-profile");
    assert.equal(first.target.team_name, "T1");
    assert.ok(first.players.length >= 5);
    assert.equal(first.players.filter((player) => player.roster_status === "CURRENT").length, 5);
    assert.ok(first.players.some((player) => player.roster_status === "OTHER_OBSERVED"));
    assert.ok(first.players.every((player) => player.champions.length > 0));
    assert.ok(first.recent_games.length > 0 && first.recent_games.length <= 5);
    assert.ok(first.recent_games.every((game) => game.picks.every((pick) => pick.player_name)));
    assert.equal(first.patch_shift.status, "OBSERVED");
    assert.ok(first.patch_shift.previous_patch_id);
    assert.equal(first.matchup.own_team_name, "Gen.G");
    assert.equal(first.matchup.priority_score, priority.score);
    assert.ok(first.matchup.staff_questions.length > 0);
    assert.ok(first.evidence.match_ids.length > 0);
    assert.match(first.boundary, /not a prediction/i);
    assert.deepEqual(JSON.parse(serializeTargetProfile(first)), first);
  } finally {
    await vite.close();
  }
});

test("builds a T1 match-day brief without guessing a TBD bracket opponent", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const schedule = JSON.parse(await readFile(new URL("public/feed/schedule.json", templateRoot), "utf8"));
  const scheduleChanges = JSON.parse(await readFile(new URL("public/feed/schedule-changes.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  const geng = feed.opponent_prep.teams.find((team) => team.team_name === "Gen.G");
  assert.ok(t1);
  assert.ok(geng);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildTargetProfile } = await vite.ssrLoadModule("/app/target-profile.ts");
    const { buildTargetMatchDayBrief, serializeTargetMatchDayBrief } = await vite.ssrLoadModule("/app/target-match-day.ts");
    const profile = buildTargetProfile(feed, t1, null);
    const tbdSchedule = {
      ...schedule,
      retrieved_at: "2026-08-25T00:00:00Z",
      available_at: "2026-08-25T00:00:00Z",
      events: [{
        event_id: "lolesports:test-t1-tbd",
        start_at: "2026-08-29T08:00:00Z",
        league: "LCK",
        block: "Playoffs",
        best_of: 5,
        participants: [{ name: "TBD", code: "TBD" }, { name: "T1", code: "T1" }],
      }],
      quality: { event_count: 1, tbd_participant_count: 1 },
    };
    const first = buildTargetMatchDayBrief(feed, t1, profile, tbdSchedule, tbdSchedule.retrieved_at, geng, scheduleChanges);
    const second = buildTargetMatchDayBrief(feed, t1, profile, tbdSchedule, tbdSchedule.retrieved_at, geng, scheduleChanges);

    assert.deepEqual(first, second);
    assert.equal(first.artifact_type, "target-match-day-brief");
    assert.equal(first.target.team_name, "T1");
    assert.equal(first.fixture.relationship, "PARTICIPANT_TBD");
    assert.equal(first.fixture.other_participant.name, "TBD");
    assert.equal(first.fixture.event_id, "lolesports:test-t1-tbd");
    assert.equal(first.fixture.best_of, 5);
    assert.ok(first.fixture.days_until > 0);
    assert.equal(first.readiness.status, "WAITING_FOR_OPPONENT");
    assert.equal(first.confirmed_matchup, null);
    const expectedMonitoringStatus = scheduleChanges.latest_run.status === "CHANGED" ? "CHANGE_DETECTED" : "WATCHING";
    const expectedLatestChange = scheduleChanges.latest_run.changes[0] ?? scheduleChanges.history[0] ?? null;
    assert.equal(first.monitoring.status, expectedMonitoringStatus);
    assert.ok(["INITIALIZED", "CHANGED", "UNCHANGED"].includes(first.monitoring.latest_run_status));
    assert.equal(first.monitoring.latest_change?.change_id ?? null, expectedLatestChange?.change_id ?? null);
    assert.equal(first.readiness.checks.find((item) => item.id === "OFFICIAL_FIXTURE").status, "PASS");
    assert.equal(first.readiness.checks.find((item) => item.id === "OPPONENT_IDENTITY").status, "WAIT");
    assert.ok(first.prepare_now.length >= 3);
    assert.ok(first.prepare_now.every((item) => item.evidence_ids.length > 0));
    assert.ok(first.unknowns.some((item) => item.includes("TBD")));
    assert.match(first.boundary, /TBD participants are never inferred/i);
    assert.deepEqual(JSON.parse(serializeTargetMatchDayBrief(first)), first);

    const confirmedSchedule = {
      ...schedule,
      events: [{
        event_id: "lolesports:confirmed-t1-geng",
        start_at: "2026-08-26T08:00:00Z",
        league: "LCK",
        block: "Playoffs",
        best_of: 5,
        participants: [{ name: "T1", code: "T1" }, { name: "Gen.G Esports", code: "GEN" }],
      }],
      quality: { event_count: 1, tbd_participant_count: 0 },
    };
    const confirmed = buildTargetMatchDayBrief(
      feed,
      t1,
      profile,
      confirmedSchedule,
      "2026-08-24T00:00:00Z",
      geng,
    );
    assert.equal(confirmed.fixture.relationship, "CONFIRMED_HEAD_TO_HEAD");
    assert.equal(confirmed.readiness.status, "READY");
    assert.equal(confirmed.fixture.other_participant.name, "Gen.G Esports");
    assert.ok(confirmed.confirmed_matchup);
    assert.equal(confirmed.confirmed_matchup.artifact_type, "confirmed-opponent-lane-report");
    assert.equal(confirmed.confirmed_matchup.status, "READY");
    assert.equal(confirmed.confirmed_matchup.own_team.team_name, "Gen.G");
    assert.equal(confirmed.confirmed_matchup.opponent.team_name, "T1");
    assert.equal(confirmed.confirmed_matchup.lanes.length, 5);
    assert.deepEqual(
      confirmed.confirmed_matchup.lanes.map((lane) => lane.review_rank),
      [1, 2, 3, 4, 5],
    );
    assert.ok(confirmed.confirmed_matchup.lanes.every((lane, index, lanes) => index === 0 || lanes[index - 1].review_score >= lane.review_score));
    assert.ok(confirmed.confirmed_matchup.lanes.every((lane) => lane.staff_questions.length > 0));
    assert.ok(confirmed.confirmed_matchup.quality.opponent_current_player_count >= 5);
    assert.ok(confirmed.confirmed_matchup.quality.own_current_player_count >= 5);
    assert.equal(confirmed.confirmed_matchup.quality.lanes_with_player_names, 5);
    assert.ok(confirmed.confirmed_matchup.quality.lanes_with_draft_signals > 0);
    assert.ok(confirmed.confirmed_matchup.evidence.match_ids.length > 0);
    assert.match(confirmed.confirmed_matchup.boundary, /do not predict lane outcome/i);
    assert.ok(confirmed.confirmed_matchup.lanes.every((lane) => (
      lane.review_score === Object.values(lane.components).reduce((sum, value) => sum + value, 0) &&
      lane.review_score >= 0 && lane.review_score <= 100
    )));
    assert.deepEqual(JSON.parse(serializeTargetMatchDayBrief(confirmed)), confirmed);

    const { TargetMatchDayPanel } = await vite.ssrLoadModule("/app/target-match-day-panel.tsx");
    const confirmedHtml = renderToStaticMarkup(createElement(TargetMatchDayPanel, {
      brief: confirmed,
      onDownload() {},
    }));
    assert.match(confirmedHtml, /CONFIRMED OPPONENT COLLISION/);
    assert.match(confirmedHtml, /Gen\.G vs T1/);
    assert.match(confirmedHtml, /PLAYER \+ DRAFT READY/);
    assert.match(confirmedHtml, /Kiin/);
    assert.match(confirmedHtml, /Doran/);
    assert.match(confirmedHtml, /P1 검토 라인/);
    assert.match(confirmedHtml, /공통 풀/);
    assert.match(confirmedHtml, /보호 자원/);
    assert.match(confirmedHtml, /상대 우선/);
    assert.match(confirmedHtml, /STAFF CHECK/);
    assert.match(confirmedHtml, /공개 데이터 경계/);
    assert.match(confirmedHtml, /cdn\/16\.16\.1\/img\/champion\//);

    const { T1OnePageBrief } = await vite.ssrLoadModule("/app/t1-one-page-brief.tsx");
    const onePageHtml = renderToStaticMarkup(createElement(T1OnePageBrief, {
      brief: confirmed,
      profile,
      onPrint() {},
      onDownload() {},
    }));
    assert.match(onePageHtml, /ONE-PAGE · STAFF REVIEW/);
    assert.match(onePageHtml, /Gen\.G vs T1 회의용 브리프/);
    assert.match(onePageHtml, /5-LANE REVIEW ORDER/);
    assert.match(onePageHtml, /[0-5]\/5 신호 확인/);
    assert.match(onePageHtml, /Kiin/);
    assert.match(onePageHtml, /Doran/);
    assert.match(onePageHtml, /인쇄 \/ PDF/);
    assert.match(onePageHtml, /전체 일정·라인 근거 보기/);

    const t1Perspective = buildTargetMatchDayBrief(
      feed,
      t1,
      profile,
      confirmedSchedule,
      "2026-08-24T00:00:00Z",
      t1,
    );
    assert.equal(t1Perspective.fixture.relationship, "TARGET_AS_OWN_TEAM");
    assert.equal(t1Perspective.confirmed_matchup.own_team.team_name, "T1");
    assert.equal(t1Perspective.confirmed_matchup.opponent.team_name, "Gen.G");
    assert.ok(t1Perspective.confirmed_matchup.quality.own_current_player_count >= 5);
    assert.ok(t1Perspective.confirmed_matchup.quality.opponent_current_player_count >= 5);
    assert.equal(t1Perspective.confirmed_matchup.quality.lanes_with_player_names, 5);

    const unavailable = buildTargetMatchDayBrief(feed, t1, profile, null, feed.cutoff, geng);
    assert.equal(unavailable.fixture.relationship, "SCHEDULE_UNAVAILABLE");
    assert.equal(unavailable.readiness.status, "WAITING_FOR_FIXTURE");
    assert.equal(unavailable.fixture.event_id, null);
    assert.equal(unavailable.confirmed_matchup, null);
  } finally {
    await vite.close();
  }
});

test("filters the large team list by name, alias, and league", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  assert.ok(t1);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { matchesTeamQuery } = await vite.ssrLoadModule("/app/radar-dashboard.tsx");
    assert.equal(matchesTeamQuery(t1, "t1"), true);
    assert.equal(matchesTeamQuery(t1, "LCK"), true);
    assert.equal(matchesTeamQuery(t1, "  t1 lck  "), true);
    assert.equal(matchesTeamQuery(t1, "LEC"), false);
    assert.ok(feed.opponent_prep.teams.filter((team) => matchesTeamQuery(team, "LCK")).length > 1);
  } finally {
    await vite.close();
  }
});

test("accepts only bounded own-team private practice and summarizes roster matches", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  assert.ok(t1);
  assert.ok(t1.player_profiles?.length);
  const player = t1.player_profiles.find((candidate) => candidate.roster_status === "CURRENT");
  assert.ok(player);

  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const {
      PRIVATE_PRACTICE_MAX_BYTES,
      buildPracticeCandidateCoverage,
      classifyPracticeRow,
      parsePrivatePracticeSession,
      summarizePrivatePractice,
      upsertPrivatePracticeRow,
    } = await vite.ssrLoadModule("/app/player-practice.ts");
    assert.equal(PRIVATE_PRACTICE_MAX_BYTES, 256 * 1024);

    const payload = {
      schema_version: "1",
      artifact_type: "private-player-practice-session",
      team_name: t1.team_name,
      recorded_at: "2026-08-27T12:00:00Z",
      rows: [
        {
          player_name: player.player_name,
          role: player.role,
          champion_id: player.champions[0]?.champion_id ?? "Azir",
          games: 8,
          wins: 5,
          comfort: 4,
          last_practiced_at: "2026-08-27T10:00:00Z",
        },
      ],
    };
    const session = parsePrivatePracticeSession(payload, t1);
    const summaries = summarizePrivatePractice(session, t1.player_profiles);
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].games, 8);
    assert.equal(summaries[0].wins, 5);
    assert.equal(summaries[0].average_comfort, 4);
    assert.equal(summaries[0].matches_public_roster, true);
    assert.deepEqual(classifyPracticeRow(session.rows[0], t1.player_profiles), {
      status: "PUBLIC_OVERLAP",
      public_game_count: player.champions[0].game_count,
      public_game_rate: player.champions[0].game_rate,
    });

    const updated = upsertPrivatePracticeRow(t1, session, { ...session.rows[0], games: 10 }, "2026-08-27T13:00:00Z");
    assert.equal(updated.rows.length, 1);
    assert.equal(updated.rows[0].games, 10);
    assert.equal(updated.recorded_at, "2026-08-27T13:00:00Z");
    assert.equal(classifyPracticeRow({ ...session.rows[0], champion_id: "PrivateOnlyChampion" }, t1.player_profiles).status, "PRIVATE_ONLY");
    assert.equal(classifyPracticeRow({ ...session.rows[0], player_name: "Internal Substitute" }, t1.player_profiles).status, "ROSTER_UNMATCHED");

    const candidate = { ...feed.entries[0], champion_id: session.rows[0].champion_id, role: session.rows[0].role };
    const noSessionCoverage = buildPracticeCandidateCoverage([candidate], t1, null);
    assert.equal(noSessionCoverage[0].status, "NO_PRIVATE_SESSION");
    const recordedCoverage = buildPracticeCandidateCoverage([candidate], t1, session);
    assert.equal(recordedCoverage[0].status, "PRACTICE_RECORDED");
    assert.equal(recordedCoverage[0].total_practice_games, 8);
    assert.equal(recordedCoverage[0].players.find((item) => item.player_name === player.player_name)?.row?.games, 8);
    const unmatchedSession = { ...session, rows: [{ ...session.rows[0], player_name: "Internal Substitute" }] };
    const unmatchedCoverage = buildPracticeCandidateCoverage([candidate], t1, unmatchedSession);
    assert.equal(unmatchedCoverage[0].status, "NO_MATCHING_PRACTICE");
    assert.equal(unmatchedCoverage[0].unmatched_row_count, 1);
    assert.equal(buildPracticeCandidateCoverage([{ ...candidate, role: "UNKNOWN" }], t1, session)[0].status, "ROSTER_UNAVAILABLE");

    const { PlayerPracticePanel } = await vite.ssrLoadModule("/app/player-practice-panel.tsx");
    const editorHtml = renderToStaticMarkup(createElement(PlayerPracticePanel, { ownTeam: t1, opponent: null, reviewCandidates: [candidate] }));
    assert.match(editorHtml, /JSON 편집 없이 한 줄씩 기록/);
    assert.match(editorHtml, /기록 추가 \/ 갱신/);
    assert.match(editorHtml, /같은 선수·포지션·챔피언은 자동 갱신/);
    assert.match(editorHtml, /탭의 메모리에만 유지/);
    assert.match(editorHtml, /TEAM DECISION × PRIVATE PRACTICE/);
    assert.match(editorHtml, /우선 검토 후보의 연습 기록만 빠르게 확인/);
    assert.match(editorHtml, /NO AUTO-RANKING/);
    assert.match(editorHtml, /Radar 순위, 상대 우선순위, 출전 판단을 변경하지 않습니다/);

    const practiceSource = await readFile(new URL("app/player-practice-panel.tsx", templateRoot), "utf8");
    assert.doesNotMatch(practiceSource, /localStorage|sessionStorage|fetch\s*\(/);

    assert.throws(
      () => parsePrivatePracticeSession({ ...payload, team_name: "Opponent Private Team" }, t1),
      /선택한 내 팀/,
    );
    assert.throws(
      () => parsePrivatePracticeSession({ ...payload, rows: [{ ...payload.rows[0], wins: 9 }] }, t1),
      /wins/,
    );
    assert.throws(
      () => parsePrivatePracticeSession({ ...payload, rows: [payload.rows[0], payload.rows[0]] }, t1),
      /중복/,
    );
  } finally {
    await vite.close();
  }
});

test("builds a canonical share link that restores the analysis workspace", async () => {
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { buildWorkspaceUrl, parseWorkspaceSearch } = await vite.ssrLoadModule("/app/workspace-link.ts");
    const shared = buildWorkspaceUrl("https://example.com/pro-meta-intelligence/t1/?utm_source=test#top", {
      teamId: "gen-g",
      opponentId: "t1",
      viewMode: "FULL",
    });
    const url = new URL(shared);
    assert.equal(url.pathname, "/pro-meta-intelligence/t1/");
    assert.equal(url.searchParams.get("team"), "gen-g");
    assert.equal(url.searchParams.get("opponent"), "t1");
    assert.equal(url.searchParams.get("view"), "full");
    assert.equal(url.searchParams.has("utm_source"), false);
    assert.equal(url.hash, "#t1-brief");
    assert.deepEqual(parseWorkspaceSearch(url.search), {
      teamId: "gen-g",
      opponentId: "t1",
      viewMode: "FULL",
    });
    assert.deepEqual(parseWorkspaceSearch("?team=%20%20&opponent=x&view=unknown"), {
      teamId: null,
      opponentId: "x",
      viewMode: null,
    });
  } finally {
    await vite.close();
  }
});

test("maps direct paths and relative navigation across product spaces", async () => {
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { productSpaceFromPath, productSpaceHref } = await vite.ssrLoadModule("/app/product-space.ts");
    assert.equal(productSpaceFromPath("/pro-meta-intelligence/"), "ONBOARDING");
    assert.equal(productSpaceFromPath("/pro-meta-intelligence/team/"), "TEAM");
    assert.equal(productSpaceFromPath("/pro-meta-intelligence/t1/index.html"), "T1");
    assert.equal(productSpaceFromPath("/creator/"), "CREATOR");
    assert.equal(productSpaceFromPath("/radar"), "RADAR");
    assert.equal(productSpaceHref("ONBOARDING", "TEAM"), "./team/");
    assert.equal(productSpaceHref("TEAM", "ONBOARDING"), "../");
    assert.equal(productSpaceHref("CREATOR", "T1"), "../t1/");
  } finally {
    await vite.close();
  }
});

test("routes plain-language home questions without sending them to AI", async () => {
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { homeSpaceForQuestion } = await vite.ssrLoadModule("/app/home-intent.ts");
    assert.equal(homeSpaceForQuestion("T1 다음 상대 핵심만 보고 싶어"), "T1");
    assert.equal(homeSpaceForQuestion("정글 조커픽과 챔피언 메타"), "RADAR");
    assert.equal(homeSpaceForQuestion("유튜브 영상 소재를 만들고 싶어"), "CREATOR");
    assert.equal(homeSpaceForQuestion("내 팀 상대 우선순위 분석"), "TEAM");
    assert.equal(homeSpaceForQuestion(""), "T1");
  } finally {
    await vite.close();
  }
});

test("classifies publication freshness at explicit safety boundaries", async () => {
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { snapshotFreshness } = await vite.ssrLoadModule("/app/freshness.ts");
    const policy = { freshHours: 12, staleHours: 36 };
    assert.deepEqual(snapshotFreshness("2026-08-25T00:00:00Z", "2026-08-25T12:00:00Z", policy), {
      level: "FRESH",
      ageHours: 12,
      ageLabel: "12시간 전",
    });
    assert.equal(snapshotFreshness("2026-08-25T00:00:00Z", "2026-08-25T12:30:00Z", policy).level, "AGING");
    assert.equal(snapshotFreshness("2026-08-25T00:00:00Z", "2026-08-26T12:00:00Z", policy).level, "AGING");
    assert.equal(snapshotFreshness("2026-08-25T00:00:00Z", "2026-08-26T12:01:00Z", policy).level, "STALE");
    assert.equal(snapshotFreshness("2026-08-26T00:00:00Z", "2026-08-25T00:00:00Z", policy).ageHours, 0);
    assert.equal(snapshotFreshness("invalid", "2026-08-25T00:00:00Z", policy).level, "UNKNOWN");
    assert.equal(snapshotFreshness(null, null, policy).ageLabel, "확인 중");

    const { DataTrustBar } = await vite.ssrLoadModule("/app/data-trust-bar.tsx");
    const freshMarkup = renderToStaticMarkup(createElement(DataTrustBar, {
      dataCutoff: "2026-08-25T00:00:00Z",
      checkedAt: "2026-08-25T06:00:00Z",
      feedKind: "published",
      scheduleRetrievedAt: "2026-08-25T02:00:00Z",
      scheduleState: "connected",
      scheduleSourceUrl: "https://example.com/schedule",
    }));
    assert.match(freshMarkup, /최신 데이터/);
    assert.match(freshMarkup, /공식 일정 확인됨/);
    assert.match(freshMarkup, /사용 가능/);
    assert.match(freshMarkup, /href="https:\/\/example.com\/schedule"/);

    const staleMarkup = renderToStaticMarkup(createElement(DataTrustBar, {
      dataCutoff: "2026-08-25T00:00:00Z",
      checkedAt: "2026-08-27T00:00:00Z",
      feedKind: "published",
      scheduleRetrievedAt: "2026-08-25T00:00:00Z",
      scheduleState: "stale",
      scheduleSourceUrl: null,
    }));
    assert.match(staleMarkup, /오래된 데이터/);
    assert.match(staleMarkup, /일정 갱신 필요/);
    assert.match(staleMarkup, /오래된 일정 제외/);
  } finally {
    await vite.close();
  }
});

test("locks the exact T1 organization as the default opponent target", async () => {
  const feed = JSON.parse(await readFile(new URL("public/feed/current.json", templateRoot), "utf8"));
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });

  try {
    const { DEFAULT_TARGET_TEAM_NAME, findDefaultTargetTeam } = await vite.ssrLoadModule("/app/radar-dashboard.tsx");
    const target = findDefaultTargetTeam(feed.opponent_prep.teams);
    assert.equal(DEFAULT_TARGET_TEAM_NAME, "T1");
    assert.ok(target);
    assert.equal(target.team_name, "T1");
    assert.equal(findDefaultTargetTeam(feed.opponent_prep.teams.slice().reverse()).team_id, target.team_id);
    assert.equal(findDefaultTargetTeam([{ ...target, team_name: "T1 Academy", team_name_aliases: [] }]), undefined);
  } finally {
    await vite.close();
  }
});

test("ships a validated same-origin publication feed for automatic loading", async () => {
  const feedText = await readFile(new URL("public/feed/current.json", templateRoot), "utf8");
  const feed = JSON.parse(feedText);
  const historyText = await readFile(new URL("public/feed/history-status.json", templateRoot), "utf8");
  const history = JSON.parse(historyText);
  const outcomesText = await readFile(new URL("public/feed/decision-outcomes.json", templateRoot), "utf8");
  const outcomes = JSON.parse(outcomesText);
  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, false);
  assert.equal(feed.patch_id, "16.16");
  assert.equal(feed.publication_readiness.ready_for_radar, true);
  assert.deepEqual(feed.publication_readiness.blocking_reasons, []);
  assert.ok(Number.isInteger(
    feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count,
  ));
  assert.ok(feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count >= 0);
  assert.ok(feed.entries.length > 0);
  assert.equal(feed.opponent_prep.artifact_type, "opponent-prep-pack");
  assert.equal(feed.opponent_prep.fixture_only, false);
  assert.equal(feed.opponent_prep.team_count, feed.opponent_prep.teams.length);
  assert.ok(feed.opponent_prep.team_count >= 100);
  const t1 = feed.opponent_prep.teams.find((team) => team.team_name === "T1");
  assert.ok(t1);
  assert.ok(t1.game_count >= feed.opponent_prep.config.minimum_games_for_review);
  assert.ok(t1.priority_picks.length > 0);
  assert.ok(t1.frequent_bans.length > 0);
  assert.ok(t1.received_bans.length > 0);
  assert.ok(t1.evidence.match_ids.length > 0);
  assert.equal(t1.player_profiles.filter((player) => player.roster_status === "CURRENT").length, 5);
  assert.ok(t1.player_profiles.some((player) => player.roster_status === "OTHER_OBSERVED"));
  assert.equal(t1.recent_games.length, 5);
  assert.equal(t1.patch_comparison.previous_patch_id, "16.15");
  assert.equal(feed.opponent_prep.config.profile_team_names[0], "T1");
  assert.equal(feed.opponent_prep.config.player_profiles_for_all_teams, true);
  assert.equal(feed.opponent_prep.teams.filter((team) => team.player_profiles).length, feed.opponent_prep.team_count);
  assert.ok(feed.opponent_prep.teams.every((team) => {
    const current = team.player_profiles.filter((player) => player.roster_status === "CURRENT");
    return current.length >= 5 && new Set(current.map((player) => player.role)).size === 5;
  }));
  assert.equal(feed.opponent_prep.teams.filter((team) => team.recent_games).length, 1);
  assert.equal(history.artifact_type, "oe-history-status");
  assert.ok(Number.isInteger(history.gate_progress_percent));
  assert.ok(history.gate_progress_percent >= 0 && history.gate_progress_percent <= 100);
  assert.equal(history.continuity.status, "ON_TRACK");
  assert.equal(history.forecast.guaranteed, false);
  assert.ok(Date.parse(history.forecast.next_collection_due_at) > Date.parse(history.as_of));
  assert.deepEqual(feed.history_status, history);
  assert.equal(outcomes.artifact_type, "team-decision-outcomes");
  assert.equal(outcomes.as_of, history.as_of);
  assert.equal(outcomes.benchmark_ready, history.benchmark_ready);
  assert.deepEqual(outcomes.evaluations, []);
  assert.ok(feedText.length < 3_500_000, "all-team role profiles should remain bounded");
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(historyText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(outcomesText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
});

test("ships a normalized official schedule companion feed", async () => {
  const schedule = JSON.parse(await readFile(new URL("public/feed/schedule.json", templateRoot), "utf8"));
  const changesText = await readFile(new URL("public/feed/schedule-changes.json", templateRoot), "utf8");
  const changes = JSON.parse(changesText);
  assert.equal(schedule.schema_version, "1");
  assert.equal(schedule.artifact_type, "pro-schedule-snapshot");
  assert.equal(schedule.source_id, "lol-esports-schedule");
  assert.match(schedule.source_url, /^https:\/\/lolesports\.com\//);
  assert.ok(schedule.events.length > 0);
  assert.equal(schedule.quality.event_count, schedule.events.length);
  assert.ok(schedule.events.every((event) => event.participants.length === 2));
  assert.ok(schedule.events.every((event) => Date.parse(event.start_at) >= Date.parse(schedule.retrieved_at)));
  assert.equal(changes.schema_version, "1");
  assert.equal(changes.artifact_type, "pro-schedule-change-log");
  assert.equal(changes.watched_team, "T1");
  assert.equal(changes.current_snapshot.content_hash, schedule.content_hash);
  assert.equal(changes.current_snapshot.retrieved_at, schedule.retrieved_at);
  assert.ok(["INITIALIZED", "CHANGED", "UNCHANGED"].includes(changes.latest_run.status));
  assert.ok(Array.isArray(changes.history));
  assert.doesNotMatch(JSON.stringify(schedule), /chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(changesText, /chatgpt|openai|gpt login|sign in/i);
});

test("ships a fail-closed human-paired AI validation status", async () => {
  const text = await readFile(new URL("public/feed/ai-validation.json", templateRoot), "utf8");
  const status = JSON.parse(text);
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const { isAIValidationStatus } = await vite.ssrLoadModule("/app/ai-validation.ts");
    assert.equal(isAIValidationStatus(status), true);
  } finally {
    await vite.close();
  }
  assert.equal(status.status, "NOT_VALIDATED");
  assert.equal(status.ai_features_enabled, false);
  assert.equal(status.paired_holdout_case_count, 0);
  assert.equal(status.gates.length, 7);
  assert.equal(status.next_action, "COLLECT_PAIRED_HUMAN_HOLDOUTS");
  assert.doesNotMatch(text, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
});

test("maps official champion names and searches in Korean or English", async () => {
  const vite = await createServer({
    root: fileURLToPath(templateRoot),
    configFile: false,
    publicDir: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
  });
  try {
    const {
      championDisplayName,
      matchesChampionQuery,
      parseChampionNameCatalog,
    } = await vite.ssrLoadModule("/app/champion-names.tsx");
    const catalog = parseChampionNameCatalog({
      data: {
        DrMundo: { id: "DrMundo", name: "문도 박사" },
        RekSai: { id: "RekSai", name: "렉사이" },
        Rell: { id: "Rell", name: "렐" },
      },
    });
    assert.equal(championDisplayName("Mundo", catalog), "문도 박사");
    assert.equal(championDisplayName("RekSai", catalog), "렉사이");
    assert.equal(championDisplayName("UnknownChampion", catalog), "UnknownChampion");
    assert.equal(matchesChampionQuery("RekSai", "렉사이", catalog), true);
    assert.equal(matchesChampionQuery("RekSai", "rek sai", catalog), true);
    assert.equal(matchesChampionQuery("Rell", "렐", catalog), true);
    assert.equal(matchesChampionQuery("Rell", "아리", catalog), false);
  } finally {
    await vite.close();
  }
});

test("starter preview files are removed", async () => {
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});
