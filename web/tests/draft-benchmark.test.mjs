import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("historical draft evaluation measures the production preview and rejects leakage", async (t) => {
  const vite = await createServer({ root: fileURLToPath(new URL("../", import.meta.url)), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
  try {
    const { evaluateDraftBenchmark } = await vite.ssrLoadModule("/app/draft-benchmark.ts");
    const { applyDraftSelection, previewOpponentPick, STANDARD_DRAFT_SEQUENCE, draftSequence, completeFearlessGame, fearlessLocks, serializeDraftScenario } = await vite.ssrLoadModule("/app/draft-agent.ts");
    const { parseDraftSession } = await vite.ssrLoadModule("/app/draft-session.ts");
    const { canAssignDistinctRoles, observedChampionRoles, previewRoleExperiment } = await vite.ssrLoadModule("/app/draft-role-experiment.ts");
    const { buildWorldsPreparation, formatKst, worldsQuarterfinalFor, worldsNextMatchFor, worldsLastResultFor, worldsRoleCoverage, WORLDS_2026 } = await vite.ssrLoadModule("/app/worlds-preparation.ts");
    const report = JSON.parse(await readFile(new URL("../public/feed/current.json", import.meta.url), "utf8"));
    report.fixture_only = true;
    const { DRAFT_SCOUT_PACKS, DRAFT_SCOUT_VALIDATION, buildDraftScoutBrief, draftScoutFor, headToHeadSeries, headToHeadStaples, scoutFreshness } = await vite.ssrLoadModule("/app/draft-scout.ts");
    const { DraftScoutPanel } = await vite.ssrLoadModule("/app/draft-scout-panel.tsx");
    await t.test("scouting applies current locks only to the matching matchup, on either side", () => {
      const pack = draftScoutFor(worldsLastResultFor("T1").opponent);
      const selections = applyDraftSelection([], "Leona");
      const props = { nameOf: (id) => id, selections, previousPicks: [] };
      for (const [blueTeamId, redTeamId] of [[pack.own.team_ids[0], pack.target.team_ids[0]], [pack.target.team_ids[0], pack.own.team_ids[0]]]) {
        const html = renderToStaticMarkup(createElement(DraftScoutPanel, { ...props, blueTeamId, redTeamId }));
        assert.match(html, /현재 연습 대진 연결/);
        assert.match(html, /<em>사용 불가/);
      }
      const unrelated = renderToStaticMarkup(createElement(DraftScoutPanel, { ...props, blueTeamId: "different", redTeamId: "other" }));
      assert.match(unrelated, /독립 스카우팅 보기/);
      assert.doesNotMatch(unrelated, /<em>사용 불가/);
    });
    await t.test("a reviewed schedule correction withholds only the exact conflicting event", async () => {
      const { applyScheduleReview, WITHHELD_SCHEDULE_EVENTS } = await vite.ssrLoadModule("/app/schedule-review.ts");
      const schedule = JSON.parse(await readFile(new URL("../public/feed/schedule.json", import.meta.url), "utf8"));
      const [review] = WITHHELD_SCHEDULE_EVENTS;
      const reviewed = applyScheduleReview(schedule);
      const stale = schedule.events.some((event) => event.event_id === review.event_id);
      assert.equal(reviewed.withheld.length, stale ? 1 : 0);
      assert.ok(!reviewed.schedule.events.some((event) => event.event_id === review.event_id));
      assert.equal(reviewed.schedule.events.length, schedule.events.length - reviewed.withheld.length);
      const conflict = { event_id: review.event_id, start_at: review.start_at, league: "Worlds", block: "Semifinals", best_of: 5,
        participants: [{ code: "BLG", name: "BILIBILI GAMING" }, { code: "T1", name: "T1" }] };
      const fixture = { ...schedule, events: [conflict] };
      assert.equal(applyScheduleReview(fixture).schedule.events.length, 0);
      // If the feed is corrected (new teams or time), the event is shown again: nothing is inferred.
      const corrected = { ...conflict, participants: [{ code: "GEN", name: "GEN.G" }, { code: "BLG", name: "BILIBILI GAMING" }] };
      assert.equal(applyScheduleReview({ ...schedule, events: [corrected] }).schedule.events.length, 1);
      assert.equal(applyScheduleReview({ ...schedule, events: [{ ...conflict, start_at: "2026-11-15T19:00:00+00:00" }] }).withheld.length, 0);
      assert.equal(applyScheduleReview(null).schedule, null);
    });
    await t.test("finished matches are labelled with their result and packs show their freshness", () => {
      // The hosted collector refreshes the packs, so expectations follow the shipped cutoff, not a fixed date.
      const packCutoff = draftScoutFor("BLG").cutoff;
      const html = renderToStaticMarkup(createElement(DraftScoutPanel, { nameOf: (id) => id, feedCutoff: "2026-11-10T02:02:04+00:00" }));
      assert.match(html, /T1 vs BLG · 밴픽 스카우팅/);
      assert.match(html, /4강 종료 · T1 1:3 패 · 다음 T1 경기 없음/);
      assert.doesNotMatch(html, /4강 상대/);
      assert.match(html, /BLG · 4강 종료 · 지난 상대/);
      assert.match(html, /결승은 GEN vs BLG \(11\.15 04:00 KST\)/);
      assert.ok(html.includes(`스카우팅 자료 갱신 ${formatKst(packCutoff)}`), formatKst(packCutoff));
      assert.match(html, /공개 피드 11\.10 11:02 KST/);
      assert.match(html, /data-freshness="CURRENT"/);
      // A refresh that failed after a newer feed was published leaves an older pack behind.
      const laterFeed = new Date(Date.parse(packCutoff) + 2 * 24 * 3_600_000).toISOString();
      const behind = renderToStaticMarkup(createElement(DraftScoutPanel, { nameOf: (id) => id, feedCutoff: laterFeed }));
      assert.match(behind, /data-freshness="BEHIND_FEED"/);
      assert.match(behind, /갱신 지연: 공개 피드보다 2\.0일 오래된 자료/);
      const cutoff = draftScoutFor("BLG").cutoff;
      assert.equal(scoutFreshness(cutoff, null, Date.parse(cutoff) + 80 * 3_600_000).status, "AGED");
      assert.equal(scoutFreshness(cutoff, null, Date.parse(cutoff) + 10 * 3_600_000).status, "CURRENT");
      assert.equal(scoutFreshness(cutoff, "2026-11-11T05:00:00+00:00").status, "CURRENT");
      assert.equal(scoutFreshness("not a date", null).status, "UNKNOWN");
    });
    await t.test("draft scouting pack follows T1's quarterfinal opponent and respects fearless locks", () => {
      assert.equal(draftScoutFor(worldsQuarterfinalFor("T1").opponent), draftScoutFor("KC"));
      // T1's semifinal has a reviewed result, so it is never shown as the next match.
      assert.equal(worldsNextMatchFor("T1"), null);
      assert.deepEqual(worldsLastResultFor("T1"), { label: "4강", start_at: "2026-11-08T22:00:00Z", opponent: "BLG", won: false, own_score: 1, opponent_score: 3 });
      // The reviewed final (current worlds-preparation.ts) is BLG's latest finished match; the semifinal stays recorded for T1.
      assert.deepEqual(worldsLastResultFor("BLG"), { label: "결승", start_at: "2026-11-14T19:00:00Z", opponent: "GEN", won: true, own_score: 3, opponent_score: 1 });
      assert.deepEqual(worldsLastResultFor("GEN"), { label: "결승", start_at: "2026-11-14T19:00:00Z", opponent: "BLG", won: false, own_score: 1, opponent_score: 3 });
      // Worlds is recorded as completed: no team has a next match, including a quarterfinalist without a recorded result.
      assert.equal(WORLDS_2026.status, "COMPLETED");
      for (const code of ["KC", "BLG", "GEN", "T1", "HLE"]) assert.equal(worldsNextMatchFor(code), null);
      assert.equal(worldsLastResultFor("KC"), null);
      assert.deepEqual(Object.keys(DRAFT_SCOUT_PACKS).sort(), ["BLG", "DK", "GEN", "IG", "KC", "LYON", "TES"]);
      for (const entry of WORLDS_2026.quarterfinals.flatMap((match) => match.teams).filter((code) => code !== "T1")) {
        assert.equal(draftScoutFor(entry).target.team_name, WORLDS_2026.teams.find((team) => team.code === entry).names[0]);
      }
      assert.equal(draftScoutFor("HLE"), null);
      const dkSeries = headToHeadSeries(draftScoutFor("DK"));
      assert.ok(dkSeries.filter((series) => series.league === "LCK").length > 1);
      assert.ok(dkSeries.every((series) => series.own_wins <= 3 && series.target_wins <= 3));
      assert.equal(headToHeadSeries(draftScoutFor("IG")).length, 0);
      const pack = draftScoutFor("KC");
      assert.equal(pack.artifact_type, "draft-scout-pack");
      assert.equal(pack.target.team_name, "Karmine Corp");
      assert.equal(pack.target.import_coverage.observed_games, pack.target.import_coverage.accepted_games + pack.target.import_coverage.excluded_games);
      const incomplete = draftScoutFor("BLG").target.import_coverage;
      assert.ok(incomplete.excluded_games > 0);
      assert.ok(!("excluded_game_details" in incomplete));
      assert.ok(!pack.quality_flags.includes("CURRENT_EVENT_GAMES_MISSING"));
      assert.ok(pack.target.leagues.WLDs > 0 && pack.own.leagues.WLDs > 0);
      assert.deepEqual(headToHeadSeries(pack).filter((series) => ["MSI", "EWC"].includes(series.league)).map((series) => [series.league, series.own_wins, series.target_wins]), [["MSI", 3, 0], ["EWC", 1, 2]]);
      assert.ok(headToHeadStaples(pack, "own").some((item) => item.champion_id === "Rumble" && item.count === 3));
      assert.deepEqual(pack.league_meta.map((group) => group.group), ["LEC", "LCK", "INTERNATIONAL"]);
      const fresh = buildDraftScoutBrief(pack);
      const busio = fresh.season.find((player) => player.player_name === "Busio");
      assert.ok(busio.season_games > busio.recent_games);
      const leona = busio.champions.find((champion) => champion.champion_id === "Leona");
      assert.ok(leona.season_games >= leona.recent_games && leona.evidence_ids.length > 0);
      const state = applyDraftSelection([], fresh.expected_picks[0].champions[0].champion_id);
      const during = buildDraftScoutBrief(pack, [], state);
      assert.ok(!during.expected_picks[0].champions.some((champion) => champion.champion_id === state[0].champion_id));
      assert.ok(during.season.flatMap((player) => player.champions).some((champion) => champion.champion_id === state[0].champion_id && champion.locked));
      assert.deepEqual(buildDraftScoutBrief(pack, [], []), fresh);
      assert.ok(fresh.deny.length > 0 && fresh.deny.every((item) => !item.locked));
      const used = fresh.deny[0].champion_id;
      const after = buildDraftScoutBrief(pack, [used]);
      assert.equal(after.deny[0].locked, true);
      const role = after.deny[0].role;
      const pool = after.pressure.find((item) => item.role === role);
      assert.equal(pool.top_remaining, pool.top_total - 1);
      assert.equal(fresh.expected_bans.length, pack.config.top_champions);
      const metaLocked = buildDraftScoutBrief(pack, [fresh.expected_bans[0].champion_id]);
      assert.ok(!metaLocked.expected_bans.some((item) => item.champion_id === fresh.expected_bans[0].champion_id));
      assert.equal(metaLocked.expected_bans.length, pack.config.top_champions);
      assert.ok(fresh.expected_picks.every((group) => group.champions.length === pack.config.top_champions));
      const firstPick = fresh.expected_picks[0].champions[0].champion_id;
      const refilled = buildDraftScoutBrief(pack, [firstPick]).expected_picks[0].champions;
      assert.ok(!refilled.some((item) => item.champion_id === firstPick));
      assert.equal(refilled.length, pack.config.top_champions);
      assert.equal(DRAFT_SCOUT_VALIDATION.league, "WLDs");
      assert.ok(DRAFT_SCOUT_VALIDATION.game_count > 0);
      assert.deepEqual(Object.keys(DRAFT_SCOUT_VALIDATION.teams).sort(), Object.keys(DRAFT_SCOUT_PACKS).sort());
      const { overall } = DRAFT_SCOUT_VALIDATION;
      // The panel leads with the international meta because it out-scored season ban habits.
      assert.ok(overall.expected_phase_one_bans.rate > overall.season_ban_habit.rate);
      assert.ok(overall.player_pool_picks.rate > overall.international_meta_picks.rate);
      // Expected picks blend the player's pool with the role meta and refill after locks.
      assert.ok(overall.expected_picks.rate > overall.player_pool_picks.rate);
    });
    await t.test("Worlds preparation requires exact main-team identity and separates official patch from evidence", () => {
      const before = JSON.stringify(report);
      const entries = buildWorldsPreparation(report);
      assert.equal(entries.length, 15);
      assert.equal(WORLDS_2026.qualification_checked_on, "2026-09-21");
      assert.equal(WORLDS_2026.checked_on, "2026-09-15");
      const additions = { DK: "Dplus Kia", TES: "Top Esports", AL: "Anyone's Legend", G2: "G2 Esports", KC: "Karmine Corp", MKOI: "Movistar KOI", IG: "Invictus Gaming", LYON: "LYON" };
      for (const [code, name] of Object.entries(additions)) {
        assert.equal(entries.find((entry) => entry.code === code).team.team_name, name);
      }
      const academyOnly = structuredClone(report);
      academyOnly.opponent_prep.teams = academyOnly.opponent_prep.teams.filter((team) => !Object.values(additions).includes(team.team_name));
      assert.ok(buildWorldsPreparation(academyOnly).filter((entry) => entry.code in additions).every((entry) => entry.team === null));
      assert.equal(WORLDS_2026.patch, "26.20");
      assert.equal(WORLDS_2026.draft_rules, "FIRST_SELECTION_VERIFIED_FEARLESS_PENDING");
      assert.match(WORLDS_2026.rules_source, /^https:\/\/cdn\.sanity\.io\/.*\.pdf$/);
      assert.equal(entries.find((entry) => entry.code === "T1").team.team_name, "T1");
      assert.equal(entries.some((entry) => entry.team?.team_name.includes("Academy")), false);
      assert.equal(JSON.stringify(report), before);
      const knockout = WORLDS_2026.quarterfinals.flatMap((match) => match.teams);
      assert.equal(new Set(knockout).size, 8);
      assert.ok(knockout.every((code) => entries.some((entry) => entry.code === code)));
      assert.deepEqual(entries.filter((entry) => entry.stage === "QUARTERFINAL").map((entry) => entry.code).sort(), [...knockout].sort());
      assert.equal(entries.find((entry) => entry.code === "HLE").stage, "OUT_OF_KNOCKOUTS");
      assert.deepEqual(worldsQuarterfinalFor("T1"), { start_at: "2026-11-06T22:00:00Z", opponent: "KC" });
      assert.equal(worldsQuarterfinalFor("KC").opponent, "T1");
      assert.equal(worldsQuarterfinalFor("G2"), null);
      assert.equal(formatKst("2026-11-06T22:00:00Z"), "11.7 07:00 KST");
      assert.equal(formatKst("2026-12-31T15:30:00Z"), "1.1 00:30 KST");
      const missing = structuredClone(report);
      missing.opponent_prep.teams = missing.opponent_prep.teams.filter((team) => team.team_name !== "T1");
      assert.equal(buildWorldsPreparation(missing).find((entry) => entry.code === "T1").team, null);
      const duplicate = structuredClone(report);
      duplicate.opponent_prep.teams.push(structuredClone(entries.find((entry) => entry.code === "T1").team));
      assert.equal(buildWorldsPreparation(duplicate).find((entry) => entry.code === "T1").team, null);
    });
    await t.test("Worlds role coverage deduplicates observed champions and never borrows other teams or global roles", () => {
      const team = structuredClone(report.opponent_prep.teams[0]);
      team.priority_picks = [
        { champion_id: "Flex", role: "TOP", game_count: 2, evidence_event_ids: ["a"] },
        { champion_id: "NoEvidence", role: "MID", game_count: 1, evidence_event_ids: [] },
        { champion_id: "NoGames", role: "MID", game_count: 0, evidence_event_ids: ["b"] },
      ];
      team.player_profiles = [{ role: "TOP", champions: [{ champion_id: " flex ", game_count: 2, evidence_event_ids: ["a"] }] },
        { role: "MID", champions: [{ champion_id: "Flex", game_count: 1, evidence_event_ids: ["c"] }] }];
      team.recent_games = [{ picks: [{ champion_id: "Flex", role: "TOP", evidence_event_id: "a" },
        { champion_id: "Other", role: "TOP", evidence_event_id: "d" }, { champion_id: "Unknown", role: "UNKNOWN", evidence_event_id: "e" }] }];
      const before = JSON.stringify(team);
      assert.deepEqual(worldsRoleCoverage(team).map((item) => item.champion_count), [2, 0, 1, 0, 0]);
      assert.deepEqual(worldsRoleCoverage(team)[0].champions[0], {
        champion_id: "Flex", evidence_count: 1, sources: ["선수별 기록", "최근 경기", "팀 주요 픽"].sort(),
      });
      assert.equal(JSON.stringify(team), before);
      assert.deepEqual(worldsRoleCoverage(null).map((item) => item.champion_count), [0, 0, 0, 0, 0]);
    });
    await t.test("Worlds champion detail merges aliases and preserves evidence and locks across input order", async () => {
      const detailReport = structuredClone(report);
      const team = buildWorldsPreparation(detailReport).find((entry) => entry.code === "GEN").team;
      team.player_profiles = [];
      team.recent_games = [];
      team.priority_picks = [
        { champion_id: "Wukong", role: "TOP", game_count: 1, evidence_event_ids: ["a", "a"] },
        { champion_id: "MonkeyKing", role: "TOP", game_count: 1, evidence_event_ids: ["a", "b"] },
        { champion_id: "Ahri", role: "MID", game_count: 1, evidence_event_ids: ["c"] },
        { champion_id: "NoEvidence", role: "MID", game_count: 1, evidence_event_ids: [" "] },
      ];
      const coverage = worldsRoleCoverage(team);
      assert.deepEqual(coverage[0].champions, [{ champion_id: "MonkeyKing", evidence_count: 2, sources: ["팀 주요 픽"] }]);
      team.priority_picks.reverse();
      assert.deepEqual(worldsRoleCoverage(team), coverage);
      const { WorldsPreparationPanel } = await vite.ssrLoadModule("/app/worlds-preparation-panel.tsx");
      const renderPanel = (previousPicks) => renderToStaticMarkup(createElement(WorldsPreparationPanel, {
        report: detailReport, nameOf: (id) => id === "MonkeyKing" ? "오공" : id,
        canChangeMatchup: false, onChooseOpponent: () => {}, previousPicks,
      }));
      const locked = renderPanel(["Wukong"]);
      assert.match(locked, /오공/);
      assert.match(locked, /피어리스 잠금/);
      assert.match(locked, /이전 픽 제외 0개/);
      assert.match(locked, /팀 주요 픽 · 근거 2건/);
      assert.doesNotMatch(renderPanel([]), /피어리스 잠금|이전 픽 제외/);
    });
    report.opponent_prep.fixture_only = true;
    report.entries = [];
    report.opponent_prep.teams = report.opponent_prep.teams.slice(0, 2);
    report.opponent_prep.team_count = 2;
    const hash = `sha256:${"a".repeat(64)}`;
    for (const source of [...report.evidence_index.source_versions, ...report.opponent_prep.evidence_index.source_versions]) source.content_hash = hash;
    const [blue, red] = report.opponent_prep.teams;
    for (const [index, team] of [blue, red].entries()) {
      team.priority_picks = Array.from({ length: 5 }, (_, rank) => ({ champion_id: `${index ? "Red" : "Blue"}${rank + 1}`, game_count: 5 - rank, game_rate: (5 - rank) / 10, phase_1_count: 0, phase_2_count: 0, evidence_event_ids: [`prior-${index}-${rank}`] }));
    }
    let selections = [];
    for (const turn of STANDARD_DRAFT_SEQUENCE) {
      selections = applyDraftSelection(selections, turn.kind === "PICK" ? `${turn.side === "BLUE" ? "Blue" : "Red"}${turn.slot}` : `Ban${selections.length}`);
    }
    const dataset = {
      schema_version: "1", artifact_type: "draft-historical-dataset", fixture_only: true, scope: "FIRST_SET_IMMEDIATE_OPPONENT_PICK",
      snapshots: [{ id: "test-snapshot", cutoff: report.cutoff, source_hash: hash, report }],
      matches: [{ snapshot_id: "test-snapshot", match_id: "held-out-fixture", game_number: 1, league: "TEST", patch_id: report.patch_id,
        observed_at: new Date(Date.parse(report.cutoff) + 86400000).toISOString(), outcome_retrieved_at: new Date(Date.parse(report.cutoff) + 172800000).toISOString(),
        outcome_source_hash: `sha256:${"b".repeat(64)}`, blue_team_id: blue.team_id, red_team_id: red.team_id, selections }],
    };
    await t.test("red first pick replays, previews, persists and carries Fearless locks", () => {
      let redSelections = [];
      for (let index = 0; index < 20; index++) redSelections = applyDraftSelection(redSelections, `RedFirst${index}`, [], "RED");
      assert.deepEqual(redSelections.map((item) => item.side), draftSequence("RED").map((item) => item.side));
      assert.equal(redSelections[6].side, "RED");
      const preview = previewOpponentPick(report, blue, red, redSelections.slice(0, 5), redSelections[5].champion_id);
      assert.equal(preview.team_name, red.team_name);
      assert.equal(preview.target_turn, 7);
      const games = completeFearlessGame([], { blue_team_id: blue.team_id, red_team_id: red.team_id, selections: redSelections });
      assert.equal(games.length, 1);
      assert.equal(fearlessLocks(games).length, 10);
      const exported = serializeDraftScenario(report, blue, red, [], games, "NewStaged", "RED");
      const restored = parseDraftSession(exported);
      assert.equal(restored.ok, true);
      assert.equal(restored.session.firstPickSide, "RED");
      assert.equal(restored.session.stagedChampion, "NewStaged");
      assert.deepEqual(restored.session.games[0].selections, redSelections);
      const legacy = JSON.parse(serializeDraftScenario(report, blue, red, []));
      legacy.schema_version = "2";
      delete legacy.first_pick_side;
      assert.equal(parseDraftSession(JSON.stringify(legacy)).session.firstPickSide, "BLUE");
      for (const version of [2, 3, ["3"], null]) {
        const malformed = { ...JSON.parse(exported), schema_version: version };
        assert.equal(parseDraftSession(JSON.stringify(malformed)).ok, false);
      }
      const invalid = JSON.parse(exported);
      invalid.first_pick_side = "PURPLE";
      assert.equal(parseDraftSession(JSON.stringify(invalid)).ok, false);
      const redDataset = structuredClone(dataset);
      redDataset.matches[0].first_pick_side = "RED";
      redDataset.matches[0].selections = redSelections;
      const result = evaluateDraftBenchmark(redDataset, { roleExperiment: true });
      assert.equal(result.case_count, 7);
      assert.equal(result.model.illegal_candidates, 0);
      assert.equal(result.role_experiment.metrics.illegal_candidates, 0);
    });
    await t.test("five-set rehearsal preserves legal deterministic previews through swaps and staged restoration", () => {
      const seriesReport = structuredClone(report);
      for (const team of seriesReport.opponent_prep.teams) {
        team.priority_picks = Array.from({ length: 60 }, (_, index) => ({
          ...team.priority_picks[0], champion_id: `Pool${index}`, game_count: 1,
          game_rate: 0.1, phase_1_count: 1, phase_2_count: 0,
        }));
      }
      let games = [];
      let checkedActions = 0;
      for (let gameIndex = 0; gameIndex < 5; gameIndex++) {
        const [currentBlue, currentRed] = gameIndex % 2
          ? [...seriesReport.opponent_prep.teams].reverse() : seriesReport.opponent_prep.teams;
        const firstSide = ["RED", "BLUE", "BLUE", "RED", "RED"][gameIndex];
        const locks = fearlessLocks(games);
        assert.equal(locks.length, gameIndex * 10);
        let current = [];
        let pickIndex = 0;
        for (const turn of draftSequence(firstSide)) {
          // Ordinary bans deliberately repeat across sets; picks must never repeat.
          const staged = turn.kind === "BAN" ? `Ban${current.length}` : `Pool${gameIndex * 10 + pickIndex++}`;
          const preview = previewOpponentPick(seriesReport, currentBlue, currentRed, current, staged, locks, 3, firstSide);
          const exported = JSON.parse(serializeDraftScenario(seriesReport, currentBlue, currentRed, current, games, staged, firstSide));
          exported.fearless_locks = []; // Serialized locks are untrusted; prior games are authoritative.
          const restored = parseDraftSession(JSON.stringify(exported));
          assert.equal(restored.ok, true);
          const session = restored.session;
          assert.deepEqual(fearlessLocks(session.games), locks);
          assert.equal(session.stagedChampion, staged);
          assert.deepEqual(session.selections, current);
          assert.deepEqual(previewOpponentPick(session.report, currentBlue, currentRed, session.selections,
            session.stagedChampion, fearlessLocks(session.games), 3, session.firstPickSide), preview);
          const unavailable = new Set([...locks, ...current.map((item) => item.champion_id), staged]);
          for (const candidate of preview.candidates) assert.equal(unavailable.has(candidate.champion_id), false);
          if (preview.status === "READY") assert.equal(preview.candidates.length, 3);
          if (locks.length) {
            exported.staged_champion = locks[0];
            assert.equal(parseDraftSession(JSON.stringify(exported)).ok, false);
            assert.equal(applyDraftSelection(current, locks[0], locks, firstSide), current);
          }
          const next = applyDraftSelection(current, staged, locks, firstSide);
          assert.equal(next.length, current.length + 1);
          current = next;
          checkedActions++;
        }
        const nextGames = completeFearlessGame(games, {
          blue_team_id: currentBlue.team_id, red_team_id: currentRed.team_id, selections: current,
        });
        assert.equal(nextGames.length, gameIndex + 1);
        games = nextGames;
      }
      assert.equal(checkedActions, 100);
      assert.equal(fearlessLocks(games).length, 50);
    });
    await t.test("role matching preserves flex alternatives and unknown picks", () => {
      const roles = new Map([["flex", new Set(["TOP", "MID"])], ["mid", new Set(["MID"])], ["top", new Set(["TOP"])]]);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid"], roles), true);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid", "Top"], roles), false);
      assert.equal(canAssignDistinctRoles(["Flex", "Mid", "Unknown"], roles), true);
      assert.equal(canAssignDistinctRoles(["A", "B", "C", "D", "E", "F"], roles), false);
    });
    await t.test("observed role feasibility reranks the full legal pool without changing production", () => {
      const clone = structuredClone(report);
      const [b, r] = clone.opponent_prep.teams;
      b.recent_games = [];
      r.recent_games = [];
      const roleOrder = ["TOP", "JUNGLE", "MID", "MID", "BOTTOM"];
      r.priority_picks.forEach((pick, index) => { pick.role = roleOrder[index]; });
      r.priority_picks.push({ ...r.priority_picks[4], champion_id: "Red6", role: "SUPPORT", game_rate: 0.05 });
      const before = JSON.stringify(clone);
      assert.deepEqual(previewOpponentPick(clone, b, r, selections.slice(0, 15), selections[15].champion_id).candidates.map((item) => item.champion_id), ["Red4", "Red5", "Red6"]);
      const result = previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id);
      assert.deepEqual(result.candidates.map((item) => item.champion_id), ["Red5", "Red6", "Red4"]);
      assert.equal(JSON.stringify(clone), before);
      r.priority_picks.push({ ...r.priority_picks[3], role: "SUPPORT" });
      assert.deepEqual([...observedChampionRoles(clone, r).get("red4")].sort(), ["MID", "SUPPORT"]);
      assert.equal(previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id).candidates[0].champion_id, "Red4");
      const withLock = previewRoleExperiment(clone, b, r, selections.slice(0, 15), selections[15].champion_id, ["Red4"]);
      assert.equal(withLock.candidates.some((item) => item.champion_id === "Red4"), false);
    });
    await t.test("known ranks, legal candidates, all seven immediate responses and deterministic output", () => {
      const before = JSON.stringify(dataset);
      const result = evaluateDraftBenchmark(dataset);
      assert.equal(result.status, "FIXTURE_ONLY");
      assert.equal(result.match_count, 1);
      assert.equal(result.case_count, 7);
      assert.deepEqual(result.case_results.map((item) => item.target_turn), [7, 8, 10, 12, 17, 18, 20]);
      for (const metrics of [result.model, result.baseline]) {
        assert.equal(metrics.top1_accuracy, 1);
        assert.equal(metrics.top3_recall, 1);
        assert.equal(metrics.mrr_at_3, 1);
        assert.equal(metrics.illegal_candidates, 0);
      }
      assert.deepEqual(evaluateDraftBenchmark(dataset), result);
      assert.equal(JSON.stringify(dataset), before);
      const reordered = structuredClone(dataset);
      reordered.snapshots[0].report.opponent_prep.teams.forEach((team) => team.priority_picks.reverse());
      assert.deepEqual(evaluateDraftBenchmark(reordered), result);
    });
    await t.test("experimental evaluation is explicit, reproducible and never promoted", () => {
      const result = evaluateDraftBenchmark(dataset, { roleExperiment: true });
      assert.equal(result.role_experiment.version, "observed-role-feasibility-v1");
      assert.equal(result.role_experiment.deployed, false);
      assert.equal(result.role_experiment.metrics.cases, 7);
      assert.equal(result.role_experiment.metrics.illegal_candidates, 0);
      assert.equal(result.role_experiment.by_league_patch[0].matches, 1);
      assert.deepEqual(evaluateDraftBenchmark(dataset, { roleExperiment: true }), result);
      assert.equal(evaluateDraftBenchmark(dataset).role_experiment, undefined);
      const invalid = structuredClone(dataset);
      invalid.snapshots[0].report.opponent_prep.teams[0].recent_games = [{
        match_id: "future-role-game", observed_at: dataset.matches[0].observed_at,
        league: "TEST", tournament: "TEST", side: "BLUE", opponent_team_id: red.team_id,
        opponent_team_name: red.team_name, result: "WIN", first_pick: true, picks: [],
      }];
      assert.throws(() => evaluateDraftBenchmark(invalid, { roleExperiment: true }), /Future role evidence/);
    });
    await t.test("rank two contributes half reciprocal rank, not a top-one hit", () => {
      const ranked = structuredClone(dataset);
      ranked.snapshots[0].report.opponent_prep.teams[0].priority_picks[0].game_rate = 0.35;
      const result = evaluateDraftBenchmark(ranked);
      for (const metrics of [result.model, result.baseline]) {
        assert.equal(metrics.top1_hits, 6);
        assert.equal(metrics.top3_hits, 7);
        assert.equal(metrics.reciprocal_rank_sum, 6.5);
        assert.equal(metrics.mrr_at_3, 0.928571);
      }
    });
    await t.test("abstentions remain in the denominator; empty datasets have no accuracy", () => {
      const empty = structuredClone(dataset);
      empty.snapshots[0].report.opponent_prep.teams.forEach((team) => { team.priority_picks = []; });
      const result = evaluateDraftBenchmark(empty);
      assert.equal(result.model.cases, 7);
      assert.equal(result.model.covered, 0);
      assert.equal(result.model.top3_recall, 0);
      empty.matches = [];
      assert.equal(evaluateDraftBenchmark(empty).model.top3_recall, null);
    });
    for (const [name, mutate, error] of [
      ["same-time candidate", (data) => { data.matches[0].observed_at = report.cutoff; }, /Future leakage/],
      ["outcome retrieved too early", (data) => { data.matches[0].outcome_retrieved_at = report.cutoff; }, /Future leakage/],
      ["same source", (data) => { data.matches[0].outcome_source_hash = hash; }, /distinct later source/],
      ["target in team evidence", (data) => { data.snapshots[0].report.opponent_prep.teams[0].evidence.match_ids.push("held-out-fixture"); }, /Target match/],
      ["duplicate match", (data) => { data.matches.push(structuredClone(data.matches[0])); }, /Duplicate outcome/],
      ["later set", (data) => { data.matches[0].game_number = 2; }, /first-set/],
      ["invalid turn", (data) => { data.matches[0].selections[0].side = "RED"; }, /draft order/],
      ["already banned outcome", (data) => { data.matches[0].selections[6].champion_id = data.matches[0].selections[0].champion_id; }, /Duplicate or empty/],
      ["mixed fixture label", (data) => { data.fixture_only = false; }, /Fixture\/real/],
      ["corrupted ranking input", (data) => { data.snapshots[0].report.opponent_prep.teams[0].priority_picks[0].game_rate = Infinity; }, /ranking inputs/],
    ]) {
      await t.test(`rejects ${name}`, () => {
        const invalid = structuredClone(dataset);
        mutate(invalid);
        assert.throws(() => evaluateDraftBenchmark(invalid), error);
      });
    }
    await t.test("champion info shows only recorded public evidence and keeps staged/confirmed distinct", async () => {
      const { summarizeChampionEvidence, DraftChampionInfo } = await vite.ssrLoadModule("/app/draft-champion-info.tsx");
      const teams = report.opponent_prep.teams;
      const blue = teams.find((team) => team.priority_picks.length > 0);
      const red = teams.find((team) => team.team_id !== blue.team_id);
      const pick = blue.priority_picks[0];
      const summary = summarizeChampionEvidence(report, blue, red, pick.champion_id);
      assert.equal(summary.has_public_sample, true);
      // Roles come only from recorded public picks/entries; nothing is filled in from the name.
      const recordedRoles = new Set([
        ...blue.priority_picks, ...red.priority_picks,
        ...[blue, red].flatMap((team) => (team.recent_games ?? []).flatMap((game) => game.picks)),
        ...report.entries,
      ].filter((item) => item.champion_id === pick.champion_id && item.role).map((item) => item.role));
      assert.deepEqual(new Set(summary.observed_roles), new Set([...recordedRoles].filter((role) => ["TOP", "JUNGLE", "MID", "BOTTOM", "SUPPORT"].includes(role))));
      const blueRow = summary.teams.find((row) => row.side === "BLUE");
      assert.equal(blueRow.team_name, blue.team_name);
      // Published artifacts can expose fewer example citations than their declared aggregate.
      // Preserve one reported row; only merging several rows requires complete citations.
      const singleRow = summarizeChampionEvidence(report, { ...blue, priority_picks: [pick] }, red, pick.champion_id).teams.find((row) => row.side === "BLUE");
      assert.equal(singleRow.summary_pick_count, pick.game_count);
      // A champion absent from every bounded summary is UNKNOWN (null), not zero, and not marked weak.
      const unseen = summarizeChampionEvidence(report, blue, red, "NotAChampionInThisFeed");
      assert.equal(unseen.has_public_sample, false);
      assert.deepEqual(unseen.observed_roles, []);
      assert.deepEqual(unseen.radar, []);
      assert.ok(unseen.teams.every((row) => row.summary_pick_count === null && row.summary_ban_count === null
        && row.summary_received_ban_count === null && row.recent_pick_count === 0));

      // Identity comes from citations, never from assuming matching roles mean matching games.
      // A missing summary stays unknown; duplicate recent records count only once.
      const tendency = (champion_id, role, game_count, evidence_event_ids) => ({ champion_id, ...(role ? { role } : {}), game_count, game_rate: 0.1, phase_1_count: 0, phase_2_count: 0, evidence_event_ids });
      const recentPick = (champion_id, role, evidence_event_id) => ({ champion_id, role, player_id: null, player_name: null, sequence: 7, evidence_event_id });
      const recentGame = (match_id, picks) => ({ match_id, observed_at: "2026-11-01T00:00:00Z", league: "WLDs", tournament: "Worlds", side: "BLUE", opponent_team_id: "X", opponent_team_name: "X", result: "WIN", first_pick: true, picks });
      const synthetic = {
        ...structuredClone(blue), team_id: "SYNTHETIC", team_name: "합성팀", game_count: 30,
        priority_picks: [tendency("Wukong", "TOP", 4, ["e1", "e2", "e3", "e4"]), tendency("MonkeyKing", "TOP", 4, ["e1", "e2", "e3", "e4"]), tendency("MonkeyKing", "JUNGLE", 2, ["e5", "e6"])],
        frequent_bans: [tendency("Ahri", null, 9, ["e8"])],
        received_bans: [tendency("Wukong", null, 3, ["e7", "e8", "e9"])],
        recent_games: [recentGame("m1", [recentPick("MonkeyKing", "TOP", "e1")]), recentGame("m2", [recentPick("Ahri", "MID", "e9")]), recentGame("m1", [recentPick("Wukong", "TOP", "e1")])],
      };
      const radarEntry = (champion_id, current_pick_count, current_distinct_team_count, eligible_for_review, evidence_event_ids) => ({ champion_id, role: "TOP", eligible_for_review, evidence_event_ids, metrics: { current_pick_count, current_distinct_team_count } });
      const aliasReport = { ...report, entries: [radarEntry("Wukong", 5, 3, false, ["r1", "r2"]), radarEntry("MonkeyKing", 4, 2, true, ["r2", "r3"])] };
      const flex = summarizeChampionEvidence(aliasReport, synthetic, null, "Wukong");
      assert.deepEqual(flex.observed_roles, ["TOP", "JUNGLE"]);
      assert.deepEqual(flex.teams, [{
        side: "BLUE", team_name: "합성팀", team_game_count: 30,
        summary_pick_count: 6, summary_ban_count: null, summary_received_ban_count: 3,
        recent_game_count: 2, recent_pick_count: 1, evidence_count: 9,
      }]);
      assert.deepEqual(flex.radar, [{ role: "TOP", current_pick_count: 5, current_distinct_team_count: 3, eligible_for_review: true, evidence_count: 3 }]);
      assert.deepEqual(summarizeChampionEvidence(aliasReport, synthetic, null, "MonkeyKing"), { ...flex, champion_id: "MonkeyKing" });
      const countAliasRows = (rows) => summarizeChampionEvidence(aliasReport, { ...synthetic, priority_picks: rows }, null, "Wukong").teams[0].summary_pick_count;
      assert.equal(countAliasRows([tendency("Wukong", "TOP", 2, ["a", "b"]), tendency("MonkeyKing", "TOP", 1, ["c"])]), 3, "same-role aliases can contain different games");
      assert.equal(countAliasRows([tendency("Wukong", "TOP", 2, ["a", "b"]), tendency("MonkeyKing", "TOP", 2, ["b", "c"])]), 3, "overlap is determined by event identity");
      assert.equal(countAliasRows([tendency("Wukong", "TOP", 4, ["a"]), tendency("MonkeyKing", "TOP", 2, ["b"])]), null, "incomplete citations cannot establish the combined count");

      const nameOf = (id) => `이름-${id}`;
      const render = (props) => renderToStaticMarkup(createElement(DraftChampionInfo, { report, blueTeam: blue, redTeam: red, nameOf, ...props }));
      const empty = render({ focus: null });
      assert.match(empty, /class="draft-champion-info empty"/);
      assert.match(empty, /챔피언을 고르면/);
      assert.doesNotMatch(empty, /role="tablist"/);
      const staged = render({ focus: { champion_id: pick.champion_id, status: "STAGED", selection: { side: "BLUE", kind: "PICK", slot: 1 } } });
      assert.match(staged, new RegExp(`<h3>이름-${pick.champion_id}</h3>`));
      assert.match(staged, /올려놓음\(확정 전\)/);
      assert.doesNotMatch(staged, /확정됨/);
      assert.match(staged, /팀 단위 공개 경기 기록이며 선수 개인 기록이 아닙니다/);
      assert.match(staged, /목록에 없으면 0회가 아니라 미확인입니다/);
      for (const label of ["개요", "룬", "아이템", "근거"]) assert.match(staged, new RegExp(`role="tab"[^>]*>${label}</button>`));
      assert.equal((staged.match(/aria-selected="true"/g) ?? []).length, 1);
      const confirmed = render({ focus: { champion_id: pick.champion_id, status: "CONFIRMED", selection: { side: "RED", kind: "BAN", slot: 2 } } });
      assert.match(confirmed, /레드 2번째 밴 · 확정됨/);
      for (const [tab, label] of [["RUNES", "룬 자료 미연결"], ["ITEMS", "아이템 자료 미연결"]]) {
        const html = render({ focus: { champion_id: pick.champion_id, status: "STAGED", selection: { side: "BLUE", kind: "PICK", slot: 1 } }, initialTab: tab });
        assert.match(html, new RegExp(label));
        assert.doesNotMatch(html, /승률|숙련도|추천 룬|추천 빌드/);
      }
      const evidence = render({ focus: { champion_id: pick.champion_id, status: "STAGED", selection: { side: "BLUE", kind: "PICK", slot: 1 } }, initialTab: "EVIDENCE" });
      assert.ok(evidence.replaceAll("<!-- -->", "").includes(`경기 패치 ${report.patch_id} · 기준 ${report.cutoff}`));
      const unseenHtml = render({ focus: { champion_id: "NotAChampionInThisFeed", status: "STAGED", selection: { side: "BLUE", kind: "BAN", slot: 1 } } });
      assert.match(unseenHtml, /관측 없음/);
      assert.match(unseenHtml, /0회라는 뜻도, 약하다는 뜻도 아닙니다/);
      assert.doesNotMatch(unseenHtml.replaceAll("<!-- -->", ""), /픽 0경기|밴 0경기|픽·밴 기록 없음/);

      // Bounded summary: listed counts are scoped, missing lists say unknown, recent games are separate.
      const flexFocus = { champion_id: "Wukong", status: "CONFIRMED", selection: { side: "BLUE", kind: "PICK", slot: 1 } };
      const flexHtml = renderToStaticMarkup(createElement(DraftChampionInfo, { report: aliasReport, blueTeam: synthetic, redTeam: null, nameOf, focus: flexFocus })).replaceAll("<!-- -->", "");
      assert.match(flexHtml, /합성팀 · 팀 공개 요약/);
      assert.match(flexHtml, /픽 6경기 · 밴 집계 미확인/);
      assert.match(flexHtml, /최근 기록 2경기 중 픽 1경기/);
      assert.match(flexHtml, /탑 · 정글/);
      assert.doesNotMatch(flexHtml, /열람 닫기|정보 열람 중/);
      const flexEvidence = renderToStaticMarkup(createElement(DraftChampionInfo, { report: aliasReport, blueTeam: synthetic, redTeam: null, nameOf, focus: flexFocus, initialTab: "EVIDENCE" })).replaceAll("<!-- -->", "");
      assert.match(flexEvidence, /우선 픽 6경기 · 자주 하는 밴 집계 미확인 · 받은 밴 3경기/);
      assert.match(flexEvidence, /경기별 확인 · 최근 2경기 중 픽 1경기/);
      assert.match(flexEvidence, /근거 기록 9건/);
      assert.equal((flexEvidence.match(/메타 레이더 · 탑/g) ?? []).length, 1);
      // Inspecting an earlier confirmed slot is labelled as read-only viewing and can be closed.
      const inspectedHtml = renderToStaticMarkup(createElement(DraftChampionInfo, { report: aliasReport, blueTeam: synthetic, redTeam: null, nameOf, focus: { ...flexFocus, inspected: true }, onCloseInspect() {} })).replaceAll("<!-- -->", "");
      assert.match(inspectedHtml, /블루 1번째 픽 · 확정됨 · 정보 열람 중/);
      assert.match(inspectedHtml, /<button type="button" class="draft-champion-close">열람 닫기<\/button>/);
    });
  } finally { await vite.close(); }
});
