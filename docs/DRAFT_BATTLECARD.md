# Draft Battlecard

The Draft Battlecard is a deterministic, own-team-versus-opponent meeting artifact built from the
same public professional-match evidence as the Opponent Prep Pack. It is designed to answer a more
useful question than a generic champion tier list: **what must this staff agree on before preparing
for this opponent?**

## Four review lanes

1. **Protect** — own-team priority picks that the selected opponent has frequently banned.
2. **Contest** — exact champion-role priorities observed for both teams.
3. **Deny review** — opponent priorities ranked by observed frequency, phase-one use, and an exact
   champion-role overlap with the global Meta Radar.
4. **Exchange** — one explicit scenario pairing an uncontested own priority with an uncontested
   opponent priority so staff can test whether the trade remains acceptable under real side and
   composition constraints.

Each signal retains the contributing draft-event IDs. The exported JSON also contains the combined
match IDs, source versions, patch cutoff, opponent-priority context, and evidence-quality state.
Ordering is deterministic and does not call an AI API.

## Claims the artifact does not make

- A frequent opponent ban is not automatically a targeted ban.
- A public priority pick is not proof of current player mastery or stage readiness.
- The exchange scenario is a meeting question, not a draft recommendation.
- Scrim results, internal priority, player condition, and match-day intent are unknown unless an
  authorized private adapter supplies them.

The dashboard exposes these unknowns beside the action lanes rather than hiding them in a generic
disclaimer.
