import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
  assert.match(html, /MY TEAM → OPPONENT PRIORITY/);
  assert.match(html, /MY TEAM LENS/);
  assert.match(html, /OPPONENT PRIORITY QUEUE|STEP 01/);
  assert.match(html, /HISTORY · WALK-FORWARD/);
  assert.match(html, /실데이터 검증 준비도/);
  assert.match(html, /일일 수집 계속/);
  assert.match(html, /3분 브리프/);
  assert.match(html, /내 팀 기준 상대 준비 순서/);
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
  assert.ok(html.indexOf('class="team-brief"') < html.indexOf('class="history-readiness'));
  assert.ok(html.indexOf('class="history-readiness') < html.indexOf('class="opponent-prep"'));
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
    const context = buildTeamContext(feed, t1.team_id);
    assert.ok(context);
    assert.equal(context.my_team.team_name, "T1");
    assert.equal(context.opponent_priorities.length, feed.opponent_prep.teams.length - 1);
    assert.ok(context.opponent_priorities.every((item) => item.team.team_id !== t1.team_id));
    assert.ok(context.opponent_priorities.every((item, index, items) => index === 0 || items[index - 1].score >= item.score));

    const genGPriority = scoreOpponent(feed, t1, geng);
    assert.ok(genGPriority.shared_leagues.includes("LCK"));
    assert.equal(genGPriority.components.same_league, 30);
    assert.equal(genGPriority.score, Object.values(genGPriority.components).reduce((sum, value) => sum + value, 0));
    assert.match(genGPriority.reasons.join(" "), /LCK/);

    const brief = buildEmergencyBrief(feed, geng, t1);
    assert.equal(brief.own_team.team_name, "T1");
    assert.equal(brief.priority_context.score, genGPriority.score);
    assert.match(brief.headline, /^T1 기준/);
    assert.ok(brief.unknowns.some((item) => item.includes("T1")));
  } finally {
    await vite.close();
  }
});

test("ships a validated same-origin publication feed for automatic loading", async () => {
  const feedText = await readFile(new URL("public/feed/current.json", templateRoot), "utf8");
  const feed = JSON.parse(feedText);
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
  assert.doesNotMatch(feedText, /C:\\\\Users|\.csv|chatgpt|openai|gpt login|sign in/i);
});

test("starter preview files are removed", async () => {
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});
