# Reviewed League-to-region Map

## Purpose

Meta Radar compares adoption across stable analytical region buckets. The source file supplies
league IDs, not a canonical region field, so publication uses an explicit reviewed mapping from
league ID to `BRAZIL`, `CHINA`, `EMEA`, `KOREA`, `LATIN_AMERICA`, `NORTH_AMERICA`, or `PACIFIC`.
These are product analysis buckets, not a claim that Riot publishes this exact taxonomy.

The map was reviewed on 2026-08-23. A league absent from the map is never guessed from its name:
the selected patch fails publication with `PATCH_HAS_UNKNOWN_LEAGUES` until the mapping is reviewed,
documented, and tested.

## Current map

| Analysis region | Source league IDs |
| --- | --- |
| Brazil | `CBLOL`, `CD` |
| China | `LPL` |
| EMEA | `AL`, `EBL`, `HLL`, `HM`, `LEC`, `LES`, `LFL`, `LIT`, `LPLOL`, `NLC`, `PRM`, `RL`, `ROL`, `TCL` |
| Korea | `KeSPA Cup`, `LCK`, `LCKC` |
| Latin America | `LRN`, `LRS` |
| North America | `LCS`, `NACL` |
| Pacific | `LCP`, `PCS` |

The 2026 EMEA ERL announcement identifies the 13 regional leagues used here, including LFL, PRM,
LIT, AL, HLL, HM, NLC, RL, LPLOL, EBL, ROL, TCL, and the Spanish ERL represented in the provider
file as `LES`. Riot's 2026 regional announcements separately place Circuito Desafiante in the
Brazilian CBLOL path, LRN/LRS in Latin America, and NACL in North America. LCK Challengers is
validated against the official LoL Esports league page. Existing tier-one league mappings remain
explicit configuration rather than runtime inference.

Reviewed references:

- [2026 ERL season dates, leagues, and key updates](https://lolesports.com/en-GB/news/2026-erl-season-dates-leagues-and-key-updates)
- [Circuito Desafiante 2026](https://lolesports.com/pt-BR/news/circuito-desafiante-2026-tudo-que-voce-precisa-saber-sobre-a-etapa-2)
- [LRN and LRS changes in 2026](https://lolesports.com/es-MX/news/cambios-en-la-lrn-y-la-lrs-en-2026)
- [NACL updates for 2026](https://lolesports.com/en-US/news/nacl-updates-for-2026)
- [LCK Challengers League](https://lolesports.com/en-US/leagues/lck_challengers_league)
- [Riot Competitive Operations library](https://competitiveops.riotgames.com/en-US/library?GAME=lol)

## Change rule

A map change requires all of the following:

1. a reviewed official competition source or equivalent first-party evidence,
2. an explicit configuration update,
3. a regression assertion for the affected league ID,
4. a real-file coverage rerun proving the selected patch has no unknown leagues.
