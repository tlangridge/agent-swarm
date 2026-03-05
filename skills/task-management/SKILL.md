---
name: task-management
description: Task lifecycle management including creation, assignment, dependencies, priorities, and completion. Use when working with the task board.
user-invocable: false
---

# Task Management

Tasks are the primary unit of work in the swarm. Every piece of work should be tracked as a task.

## Task Lifecycle

```
open -> in-progress -> done
  \                     /
   -> blocked  --------/
```

- **open** -- Available for pickup
- **in-progress** -- An agent is actively working on it
- **blocked** -- Work cannot continue (dependency unmet, error encountered)
- **done** -- Work completed and verified

## Task Commands

### Viewing Tasks
```
swarm tasks               - List all tasks
swarm tasks --mine         - List your assigned tasks
swarm tasks --ready        - List tasks ready for pickup (deps met, unassigned)
swarm tasks --status open  - Filter by status
swarm task show <id>       - Show task details
```

### Creating Tasks (lead/creator)
```
swarm task create <title> --desc "description" --priority high --assign <name>
swarm task create <title> --depends id1,id2 --branch feature/xyz
```

Always include when creating tasks:
- A specific, actionable title (not "fix tests" but "Fix failing jest tests in server/services/task-board.test.ts")
- `--desc` with: (1) what to do, (2) which files to modify, (3) acceptance criteria
- `--priority` (urgent/high/medium/low)
- `--depends id1,id2` if this task requires another task to finish first
- `--assign` to a specific agent when possible

### Working on Tasks
```
swarm task pick <id>       - Self-assign and start working
swarm task update <id> --branch <branch>    - Link your branch
swarm task update <id> --pr <number> --pr-url <url>  - Link a PR
swarm task update <id> --issue <number> --issue-url <url>  - Link an issue
```

### Completing Tasks
```
swarm task verify <id> <command>   - Run verification (e.g., npm test)
swarm task done <id> --output "summary of what was produced"
swarm task fail <id> <reason>      - Mark as blocked with reason
```

## Dependencies

Tasks can depend on other tasks via `--depends id1,id2`. A task with unmet dependencies cannot be picked up. Use `swarm tasks --ready` to find tasks whose dependencies are all satisfied.

## Priorities

- **urgent** -- Drop everything and work on this
- **high** -- Next up after current task
- **medium** -- Normal priority (default)
- **low** -- Nice to have, do when nothing else is pending

## Output Summaries

When marking a task done, ALWAYS include `--output "summary"`. This provides context to downstream tasks that depend on your work. A good output summary includes:
- What was changed (files, APIs, data models)
- Any decisions made during implementation
- Known limitations or follow-up items
