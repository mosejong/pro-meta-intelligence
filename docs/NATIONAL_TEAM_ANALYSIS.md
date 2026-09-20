# National-team observation review — 2026-09-20

Draft Lab now separates a selected player's club baseline, partial national-team match
observations and a device-local hypothesis journal. It does not construct a national-team
prediction profile by summing club teams. Existing deterministic draft predictions and Fearless
rules are unchanged; they are not presented as validated rules for this exhibition.

## Reviewed evidence

The selector keeps each series and its sources separate. Vietnam is the default latest review;
switching to USA restores its observations and lineup note. Missing news observations never
establish absence, non-use or the reason for selection.

- [Busan Esports Arena notice](https://brena.or.kr/brena/notice.do?articleNo=2999&mode=view&srCategoryId=):
  September 19 Korea–USA and September 20 Korea–Vietnam evaluation matches.
- [Inven match report, September 19](https://www.inven.co.kr/webzine/news/?news=321196):
  Korea won the USA series 3–0. Seven player/champion assignments are explicitly described:
  game 1 Canyon/Qiyana and Zeka/Ryze; game 2 Canyon/Pantheon, Gumayusi/Caitlyn and Keria/Bard;
  game 3 Zeka/Twisted Fate and Zeus/Shen. These are partial news observations, not full drafts.
- [OSEN interview, September 19](https://www.osen.co.kr/article/G1112878541): Faker did not play
  in the USA series. This is not evidence about skill or the reason for selection.
- [Inven match report, September 20, 21:53 KST](https://www.inven.co.kr/webzine/news/?news=321214):
  Korea won the Vietnam series 3–1. Six selected partial observations cover Zeus/Gragas (game 1),
  Zeus/Camille, Keria/Poppy and Canyon/Nocturne (game 3), Faker/Anivia and Gumayusi/Caitlyn
  (game 4). The source describes both lost and recovered fights; these are retrospective examples,
  not scored predictions or an exhaustive champion list. The team prompt separates responses
  to isolation from objective preparation instead of inferring one stable tendency from victory.

The [OSEN game-two report](https://www.osen.co.kr/article/G1112878440) and Inven differ in
the opposing jungler's champion, and some names in OSEN are not verified canonical IDs.
Those assignments, ordered drafts, restrictions, patch and Fearless clauses remain unverified.
Do not reconstruct missing choices from article order. No event pick rate is computed.

## What can be compared now

Only a unique exact player-name and role match within an LCK team supplies the club baseline.
Academy teams, fuzzy names, ambiguous identities and fixture reports supply no baseline.
Team membership is read from the dated source report, never guessed from a remembered roster.
Show its patch, cutoff, match denominator and cited champions. Truncated lists cannot establish
non-use, total pool size, mastery or a new champion debut.

The USA report suggests hypotheses about changing jungle attention, support movement and
top/mid reinforcement. These remain hypotheses conditional on opponent, lineup, patch, side,
first-pick position and set number. One series cannot establish stable preferences or causality.
Club observations, national-team observations and Worlds evidence remain separate.

## Prospective review procedure

1. Before viewing the target outcome, name the exact opponent/set and player or team.
2. Save a concrete hypothesis and measurable criterion, including what would contradict it
   and when footage is insufficient. Record game-clock windows for movement claims.
3. After the target game, attach the observed action, video time and HTTPS source. Select
   supported, contradicted or insufficient. Saved criteria and completed verdicts cannot be
   edited through the UI. Do not turn missing footage into a miss or success.
4. Export the local JSON for review. Device timestamps are unverified; this journal is not
   tamper-proof preregistration and contributes no official prediction-accuracy metric.
5. For formal evaluation, obtain complete timestamped draft/lineup/rule evidence and a trusted
   prediction registration before the next choice. Freeze model and evidence version, retain
   abstentions, report top-1/top-3 and legality with both match and state denominators, and keep
   exhibitions separate from club leagues and from tuning samples.

No full broadcast or automated live national-team feed has been connected. The thirteen partial
observations support retrospective review only. The journal records human hypotheses, not
automatic model predictions, and does not measure analyst utility.
