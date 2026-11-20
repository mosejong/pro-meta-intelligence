import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

// Offline diagnostic. External references are manually checked fixtures, never fetched here.
const root = new URL("../", import.meta.url);
const reference = JSON.parse(await readFile(new URL("tests/fixtures/worlds-final-gen-blg-20261114.json", root), "utf8"));
const vite = await createServer({ root: fileURLToPath(root), configFile: false, publicDir: false, server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
try {
  const { applyDraftSelection, draftSequence, fearlessLocks, completeFearlessGame } = await vite.ssrLoadModule("/app/draft-agent.ts");
  const { championAssetId } = await vite.ssrLoadModule("/app/champion-assets.ts");
  const { suggestSoloDraftTurn } = await vite.ssrLoadModule("/app/solo-draft.ts");
  const { SHARE_CHAMPIONS } = await vite.ssrLoadModule("/app/share-champion-ids.ts");
  const ids = new Map(SHARE_CHAMPIONS.map(([, id]) => [id.toLowerCase(), id]));
  const canonical = name => { const id = ids.get(championAssetId(name).toLowerCase()); if (!id) throw new Error(`Unsupported actual reference champion: ${name}`); return id; };
  const sources = [
    ["PRE_FINAL_FROZEN_REPORT", new URL("tests/fixtures/eligible-feed-20261114.json", root)],
    ["CURRENT_POST_FINAL_REPORT_NOT_PREDICTIVE", new URL("public/feed/current.json", root)],
  ];
  const evaluations = [];
  for (const [kind, path] of sources) {
    const raw = await readFile(path), report = JSON.parse(raw);
    if (kind === "PRE_FINAL_FROZEN_REPORT" && Date.parse(report.cutoff) >= Date.parse(reference.first_game_at)) throw new Error("Pre-final report is not pre-final");
    let actualPrevious = [];
    const rows = [];
    for (const game of reference.games) {
      const blueTeam = report.opponent_prep.teams.find(t => t.team_name === game.blue);
      const redTeam = report.opponent_prep.teams.find(t => t.team_name === game.red);
      if (!blueTeam || !redTeam) throw new Error("Exact final teams unavailable");
      const manualSide = game.blue === "Gen.G" ? "BLUE" : "RED";
      const previousPicks = fearlessLocks(actualPrevious), actual = [];
      const append = (state, name) => {
        const next = applyDraftSelection(state, canonical(name), previousPicks, "BLUE");
        if (next === state) throw new Error(`Illegal actual reference G${game.game}: ${name}`);
        return next;
      };
      let actualState = [];
      for (const turn of draftSequence("BLUE")) {
        const key = `${turn.side.toLowerCase()}_${turn.kind === "BAN" ? "bans" : "picks"}`;
        actualState = append(actualState, game[key][turn.slot - 1]);
        actual.push(actualState.at(-1));
      }
      const base = { report, blueTeam, redTeam, previousPicks, firstPickSide: "BLUE", manualSide };
      const prefixResponses = [];
      for (const turn of actual) if (turn.side !== manualSide) {
        const proposed = suggestSoloDraftTurn({ ...base, selections: actual.slice(0, turn.turn - 1) });
        if (!proposed) throw new Error(`No response to legal actual prefix G${game.game} turn${turn.turn}`);
        prefixResponses.push({ turn: turn.turn, kind: turn.kind, actual_blg: turn.champion_id, automated_blg: proposed.champion_id, source: proposed.source, reason: proposed.reason, matches_actual: proposed.champion_id === turn.champion_id });
      }
      let counterfactual = [], stop = null;
      const reactions = [];
      for (const intended of actual) {
        if (intended.side === manualSide) {
          const next = applyDraftSelection(counterfactual, intended.champion_id, previousPicks, "BLUE");
          if (next === counterfactual) {
            const blocker = counterfactual.find(s => s.champion_id === intended.champion_id);
            stop = { turn: intended.turn, kind: intended.kind, geng_intended: intended.champion_id, reason: "ACTUAL_GEN_CHOICE_UNAVAILABLE_AFTER_AUTOMATED_BRANCH", blocker: blocker ?? null };
            break;
          }
          counterfactual = next;
        } else {
          const proposed = suggestSoloDraftTurn({ ...base, selections: counterfactual });
          if (!proposed) throw new Error("Counterfactual stalled without a valid reason");
          const next = applyDraftSelection(counterfactual, proposed.champion_id, previousPicks, "BLUE");
          if (next === counterfactual) throw new Error("Automatic opponent proposed an illegal action");
          counterfactual = next;
          reactions.push({ turn: intended.turn, kind: intended.kind, champion_id: proposed.champion_id, source: proposed.source });
        }
      }
      rows.push({ game: game.game, geng_side: manualSide, prior_actual_pick_locks: previousPicks.length, actual, actual_prefix_responses: prefixResponses, closed_loop: { completed_turns: counterfactual.length, selections: counterfactual, reactions, stop } });
      const next = completeFearlessGame(actualPrevious, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections: actual });
      if (next.length !== actualPrevious.length + 1) throw new Error("Reference series cannot be legally replayed");
      actualPrevious = next;
    }
    let simulatedPrevious = [];
    const seriesClosedLoop = [];
    for (const row of rows) {
      const ref = reference.games.find(g => g.game === row.game);
      const blueTeam = report.opponent_prep.teams.find(t => t.team_name === ref.blue), redTeam = report.opponent_prep.teams.find(t => t.team_name === ref.red);
      const locks = fearlessLocks(simulatedPrevious);
      let selections = [], stop = null;
      for (const intent of row.actual) {
        const choice = intent.side === row.geng_side ? intent : suggestSoloDraftTurn({ report, blueTeam, redTeam, selections, previousPicks: locks, firstPickSide: "BLUE", manualSide: row.geng_side });
        if (!choice) throw new Error("Continuous series stalled without explanation");
        const next = applyDraftSelection(selections, choice.champion_id, locks, "BLUE");
        if (next === selections) {
          if (intent.side !== row.geng_side) throw new Error("Illegal automatic series response");
          stop = { turn: intent.turn, kind: intent.kind, geng_intended: intent.champion_id, reason: locks.includes(intent.champion_id) ? "PREVIOUS_SIMULATED_PICK_LOCK" : "ALREADY_BANNED_OR_PICKED_IN_THIS_SET", blocker: selections.find(s => s.champion_id === intent.champion_id) ?? null };
          break;
        }
        selections = next;
      }
      seriesClosedLoop.push({ game: row.game, previous_simulated_pick_locks: locks.length, completed_turns: selections.length, selections, stop });
      if (stop) break;
      const next = completeFearlessGame(simulatedPrevious, { blue_team_id: blueTeam.team_id, red_team_id: redTeam.team_id, selections });
      if (next.length !== simulatedPrevious.length + 1) throw new Error("Illegal continuous simulated series");
      simulatedPrevious = next;
    }
    evaluations.push({ kind, report_cutoff: report.cutoff, report_sha256: createHash("sha256").update(raw).digest("hex"), rows, series_closed_loop: seriesClosedLoop });
  }
  const result = { artifact_type: "worlds-final-solo-response-diagnostic", schema_version: 1, reference, boundary: "Prefix responses each see the actual earlier choices, not earlier simulated choices. Per-row closed loops are independent with actual prior-set pick locks. series_closed_loop carries simulated prior picks and stops the entire run at a blocked Gen.G choice. No outcome, skill, or predictive accuracy claim. Current report contains post-match information. Pre-final means report cutoff, not proof of preregistration.", evaluations };
  if (!process.argv[2]) throw new Error("Provide a new output path");
  await writeFile(process.argv[2], JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(evaluations.map(e => ({ kind: e.kind, cutoff: e.report_cutoff, games: e.rows.map(g => ({ game: g.game, exact_actual_blg_actions: g.actual_prefix_responses.filter(x => x.matches_actual).length, total_blg_actions: g.actual_prefix_responses.length, fallback: g.actual_prefix_responses.filter(x => x.source === "FALLBACK").length, closed_loop_turns: g.closed_loop.completed_turns, stop: g.closed_loop.stop })) })), null, 2));
} finally { await vite.close(); }
