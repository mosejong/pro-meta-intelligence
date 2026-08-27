# Player Tendency Analyst Bot

## Product role

The Player Tendency Analyst Bot answers questions about observed professional-match choices. It is
not a personality profiler, player-rating model, hidden-account finder, or prediction of match-day
form. The Team surface combines two deliberately separated evidence classes:

- public professional-match player, role, champion, match, and event records;
- an optional own-team practice session explicitly entered or loaded in the current browser tab.

The opponent path never receives the own-team practice session and never manufactures opponent
practice, scrim, coaching, psychological, or account data.

## Current release mode

The production bot currently reports
`generation_mode=DETERMINISTIC_EVIDENCE_ROUTER` and `ai_generated=false`. Natural-language
questions are normalized and routed to one of six bounded intents:

1. overall observed-choice summary;
2. repeated champion pool;
3. own-team practice cross-check;
4. same-role public comparison;
5. sample and interpretation risk;
6. prohibited inference refusal.

Every answer has a fixed structure: conclusion, typed facts, public evidence IDs, data boundaries,
and a public/private classification. Questions and answers remain React state only. There is no
chat history, browser persistence, account, server request, or model request.

## Refusal boundary

Questions about personality, mentality, psychology, emotions, tilt, confidence, character,
personal life, condition, form, ability, or hidden accounts route to `PROHIBITED_INFERENCE`. The bot
does not convert the question into a score. It explains that those attributes cannot be inferred
from choice records and suggests observable alternatives such as repeated champions, sample size,
and role-level comparison.

Champion frequency is not a claim of mastery. Missing practice data is not negative evidence. A
public team result is not proof of a player's causal impact. A current-roster label means the latest
public match in the bounded source, not a confirmed future starter.

## Private-data flow

| Operation | Public player data | Own-team practice | Opponent private data |
| --- | --- | --- | --- |
| Own-team public summary | Used | Not required | Never used |
| Own-team practice question | Used | Current tab only | Never used |
| Opponent summary | Used | Deliberately removed from input | Never used |
| Same-role comparison | Public facts from both teams | Not used | Never used |
| Share link/public feed | Public selection only | Excluded | Never used |

An answer that uses the own-team practice session sets `private_data_used=true` and
`publishable=false`. Closing the tab or changing the own team removes the session. The only durable
path remains an explicit user-initiated private JSON download.

## Generative AI connection contract

The future model is a wording layer, not a retrieval or scoring authority:

```text
question
  -> deterministic intent router
  -> frozen player/team/snapshot facts
  -> allowed claim, evidence, and boundary IDs
  -> pinned model structured output
  -> deterministic ID validation
  -> human-reviewed answer
```

The model must return only selected claim IDs, evidence IDs, boundary IDs, and bounded prose tied to
those IDs. An invented ID, missing required boundary, opponent-private claim, psychological claim,
or unsupported causal explanation is a critical error. Provider, model, model version, prompt
version, and tool contract must be pinned.

No provider is connected in the public release. A user API key must not be put into this static
GitHub Pages client. A future provider adapter requires an approved private runtime or local
companion, explicit no-retention handling, credential isolation, request-size limits, and a visible
off switch. Private practice must remain outside external model calls unless an authorized team
deployment explicitly opts in.

## Release evaluation

Generative answers remain locked until a player-tendency holdout contains at least 30 paired cases
and passes the existing AI release policy:

- claim and evidence macro F1 at least 0.90 and noninferior to the paired human by no more than 0.02;
- zero unsupported, psychological, opponent-private, or boundary-omission critical errors;
- 100% required boundary retention;
- AI median active time at most half the human median and faster on at least 80% of cases;
- at least 80% accepted without edit;
- fully pinned and reproducible system metadata.

Until then, the UI displays `AI LOCKED`, the public validation feed remains fail-closed, and the
deterministic answer remains available. A model outage or invalid response must fall back to the
same deterministic answer rather than returning unverified prose.

## Test cases required before provider work

The paired set must cover at least:

- low and high public match samples;
- one-player champion concentration and wider observed pools;
- own-team session present, absent, incomplete, and roster-name mismatch;
- opponent-practice requests;
- psychological and hidden-account requests;
- same-role comparison with one missing public roster;
- Korean and English champion queries;
- prompt injection that asks to ignore boundaries or invent a scouting conclusion.

The deterministic router is not the human reference. An expert must seal required and allowed IDs
without seeing either the human or model answer, and the private holdout assembler must join the
three paths by the frozen task fingerprint.
