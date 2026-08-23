# Competitive Positioning

Reviewed: 2026-08-23

## Do not build another statistics destination

The public League ecosystem already covers the lookup and descriptive-statistics layer well:

- [OP.GG Esports](https://esports.op.gg/apps?hl=en_US) exposes schedules, standings, team/player
  statistics, POG, and champion rankings. Its own help documentation also describes league
  pick/ban rankings and comparisons between ranked and professional-league champion metas.
- [FOW](https://www.fow.lol/?hl=ko_KR) exposes summoner lookup, live viewing, champion analysis,
  rankings, specialist rankings, and multisearch; its champion table includes win, pick, and ban
  rates.
- [Oracle's Elixir](https://master.d36liwrx5rvjnc.amplifyapp.com/tools/downloads) publishes
  analyst-ready professional-match CSV data, while [Games of
  Legends](https://gol.gg/tournament/tournament-stats/premium/esports/) provides broad tournament,
  team, player, side, and champion statistics.
- A generic coaching dashboard is not a sufficient differentiator either. [Oracle
  Esports](https://www.oracle-esport.com/en) already markets separate manager, coach, draft,
  analyst, and player workspaces.

Pro Meta Intelligence should therefore avoid making its home page a larger stat table. Its owned
workflow is narrower:

```text
time-locked signal
  -> evidence and counterevidence
  -> staff review priority
  -> practice question and stop condition
  -> human decision
  -> later outcome and failure review
```

## Competitive boundary

| Need | Existing services | Pro Meta Intelligence |
| --- | --- | --- |
| Summoner lookup, builds, tiers, rankings | Strong incumbent territory | Explicit non-goal |
| Schedules, standings, player and tournament tables | Strong incumbent territory | Link/source input only |
| Current professional pick/ban and regional statistics | Widely available description | Evidence primitives, not the final product |
| What should staff review today? | Usually left to the reader | Five-item deterministic decision brief |
| What argues against the signal? | Often absent or implicit | First-class counterevidence |
| What should a scrim test answer? | Not connected to the signal | Structured practice question and stop condition |
| Was the early warning useful without hindsight? | Not the main public product | Phase 3 Recall@K, lead time, false alerts, miss log |
| Private mastery and scrim information | Some commercial staff tools | Authorized adapter only; never inferred from public data |

## Defensible product claim

> OP.GG and FOW help a user inspect what is popular and what happened. Pro Meta Intelligence helps
> a coaching staff decide what deserves scarce review and practice time, records why, and later
> measures whether that decision support was useful.

This claim remains provisional until Phase 3 produces real point-in-time backtest results. The
current Team Decision Brief proves the workflow and evidence boundary, not predictive superiority.

