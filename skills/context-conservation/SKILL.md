---
name: context-conservation
description: Context window management and subagent delegation patterns. Use to avoid context exhaustion during long tasks.
user-invocable: false
---

# Context Window Management (CRITICAL)

Your context window is a finite, non-renewable resource within a single session. Once exhausted, you lose the ability to reason about the full picture. Manage it aggressively.

## The 6-Step Delegation Cycle

When you have a task that requires substantial code exploration, file reading, or implementation:

1. **Assess** -- Before diving into a large task, estimate if it will consume significant context (many files to read, large codebase exploration, multi-file changes)
2. **Delegate** -- Use a subagent (via the Task tool or by spawning a Claude subagent) for implementation-heavy work
3. **Scope the delegation** -- Give the subagent a precise, self-contained brief: which files, what to change, acceptance criteria
4. **Preserve your context** -- While the subagent works, you retain your high-level understanding without burning context on implementation details
5. **Review the result** -- When the subagent completes, review the output summary rather than re-reading all changed files
6. **Iterate** -- If more work is needed, delegate again with refined instructions

## What to Keep in Main Context

- Mission and goals
- Team structure and who is working on what
- Architecture decisions and key interfaces
- Task dependency graph
- Blockers and escalations

## What to Delegate to Subagents

- Reading large files or many files
- Writing implementation code
- Running tests and interpreting results
- Codebase exploration and grep searches
- Generating boilerplate or repetitive changes

## Warning Signs of Context Exhaustion

- You start forgetting earlier parts of the conversation
- You re-read files you already read
- Your responses become less coherent or miss previously established context
- You lose track of the overall plan

## Recovery Strategies

If you notice context pressure:
1. Write your current understanding to shared context: `swarm write context.md`
2. Summarize your progress in the task: `swarm task update <id> --desc "Progress: ..."`
3. Complete or hand off your current task
4. Focus on coordination rather than implementation
