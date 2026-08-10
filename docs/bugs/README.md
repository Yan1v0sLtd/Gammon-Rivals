# Bugs

Confirmed defects tracked for fixing. Each bug file uses an ordered name prefix
and records the problem, evidence, and acceptance criteria.

Confirmed defects that are part of an as-built reference are documented there
(for example, the Daily Missions defects in
`reference/02-daily-missions-reference.md`). When a defect is extracted for
tracking, it belongs here.

Bugs:

1. `01-mission-reroll-keeps-old-goal.md` — `reroll_mission` swaps the template
   but writes `resolved_goal = resolved_goal`.
