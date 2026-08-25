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

test("server-renders the Meta Radar analyst surface", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Meta Radar · Pro Meta Intelligence<\/title>/i);
  assert.match(html, /REKSAI/i);
  assert.match(html, /종합 점수 없음/);
  assert.match(html, /오늘 팀이/);
  assert.match(html, /결정할 3가지/);
  assert.match(html, /LIVE DECISION QUEUE/);
  assert.match(html, /티어표가 아니라 회의 시작점입니다/);
  assert.match(html, /전체 메타 신호 탐색/);
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
  assert.ok(html.indexOf('class="decision-flow"') < html.indexOf('class="team-brief"'));
  assert.ok(html.indexOf('class="team-brief"') < html.indexOf('class="history-readiness'));
  assert.ok(html.indexOf('class="history-readiness') < html.indexOf('class="opponent-prep"'));
  assert.ok(html.indexOf('class="opponent-prep"') < html.indexOf('class="creator-export"'));
  assert.ok(html.indexOf('class="creator-export"') < html.indexOf('class="workspace"'));
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
    assert.equal(first.monitoring.status, "WATCHING");
    assert.equal(first.monitoring.latest_run_status, "INITIALIZED");
    assert.equal(first.monitoring.latest_change, null);
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
    assert.equal(confirmed.confirmed_matchup.status, "LIMITED");
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
    assert.equal(confirmed.confirmed_matchup.quality.own_current_player_count, 0);
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
    assert.match(confirmedHtml, /TEAM-LEVEL LIMITED/);
    assert.match(confirmedHtml, /P1 검토 라인/);
    assert.match(confirmedHtml, /공통 풀/);
    assert.match(confirmedHtml, /보호 자원/);
    assert.match(confirmedHtml, /상대 우선/);
    assert.match(confirmedHtml, /STAFF CHECK/);
    assert.match(confirmedHtml, /공개 데이터 경계/);
    assert.match(confirmedHtml, /cdn\/16\.16\.1\/img\/champion\//);

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
    assert.equal(t1Perspective.confirmed_matchup.quality.opponent_current_player_count, 0);

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
  assert.equal(feed.schema_version, "1");
  assert.equal(feed.fixture_only, false);
  assert.equal(feed.patch_id, "16.16");
  assert.equal(feed.publication_readiness.ready_for_radar, true);
  assert.deepEqual(feed.publication_readiness.blocking_reasons, []);
  assert.equal(
    feed.publication_readiness.selected_patch_import_quality.known_exclusion_game_count,
    24,
  );
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
  assert.equal(feed.opponent_prep.teams.filter((team) => team.player_profiles).length, 1);
  assert.equal(history.artifact_type, "oe-history-status");
  assert.ok(Number.isInteger(history.gate_progress_percent));
  assert.ok(history.gate_progress_percent >= 0 && history.gate_progress_percent <= 100);
  assert.equal(history.continuity.status, "ON_TRACK");
  assert.equal(history.forecast.guaranteed, false);
  assert.ok(Date.parse(history.forecast.next_collection_due_at) > Date.parse(history.as_of));
  assert.deepEqual(feed.history_status, history);
  assert.ok(feedText.length < 3_000_000, "target enrichment should not bloat every team payload");
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
  assert.doesNotMatch(historyText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
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

test("starter preview files are removed", async () => {
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});
