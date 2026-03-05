---
name: shift-protocol
description: Shift lifecycle including badge-in, active work periods, closing procedures, and close report contribution. Use when managing shift transitions.
user-invocable: false
---

# Shift Protocol

Shifts are bounded work periods with a defined start and end.

## Shift Lifecycle

1. **Badge-in** -- Agents are spawned and initialized. The lead receives a kickoff message with team roster and instructions.
2. **Active work** -- Agents coordinate, create tasks, and execute work.
3. **Ready for review** -- The lead marks the shift as ready for human review when all planned work is done.
4. **Badge-out** -- The shift ends, agents are terminated, worktrees are preserved.

## At Shift Start (Lead)

1. Read existing context: `swarm context`
2. Check current tasks: `swarm tasks`
3. Read the previous shift's close report if available: `swarm read close-report.md`
4. If there are existing tasks, assess what needs to be done
5. If there are no tasks, wait for the user's mission, then break it into tasks and assign them
6. Send clear instructions to each worker agent

## At Shift Start (Worker)

1. Check for tasks: `swarm tasks --mine`
2. If no tasks, stand by and wait for the lead
3. Read context when available: `swarm context`
4. Read shared findings: `swarm read findings.md`

## During Active Work

- Lead monitors progress with `swarm activity`
- Workers execute tasks and report progress
- Discoveries are shared via `swarm append findings.md --content "..."`
- Blockers are escalated immediately

## Shift Closing (Lead)

When all planned work is done:
1. Verify all tasks are marked done or have clear status
2. Ensure all branches are pushed and PRs are created
3. Write a shift summary: `swarm write close-report.md` with:
   - What was accomplished
   - What is still pending
   - Key decisions made
   - Known issues or risks
4. Mark the shift as ready for review: `swarm shift review "Summary of accomplishments"`

## Reading Previous Shift Reports

At the start of a new shift, always check for a previous close report:
```
swarm read close-report.md
```

This provides continuity between shifts and prevents re-doing completed work.
