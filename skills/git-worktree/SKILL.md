---
name: git-worktree
description: Git worktree isolation protocol including branch conventions, linking branches to tasks, and PR creation. Use when working in a dedicated worktree.
user-invocable: false
---

# Git Worktree Isolation

Each agent works in a dedicated git worktree with its own branch. This prevents merge conflicts between agents working simultaneously.

## Branch Convention

Your worktree branch follows the pattern: `swarm/<agent-name>/<date>`

For example: `swarm/alice/20260304`

## Critical Rules

1. **Do NOT switch branches.** Your worktree is checked out to your assigned branch. Switching branches would break isolation. If you need to reference another branch, use `git diff` or `git log` with the branch name -- do not checkout.

2. **Do NOT run `git checkout`** on any branch other than your assigned one. The worktree system manages branches for you.

3. **Commit frequently.** Since you are on your own branch, there is no risk of conflicting with others. Commit early, commit often.

## Linking Branches to Tasks

When you start working on a task, link your branch:
```
swarm task update <id> --branch <your-branch>
```

This makes it visible in the dashboard which task is associated with which branch.

## Creating Pull Requests

When your task is complete:
1. Commit and push your branch
2. Create a PR targeting the main branch
3. Link the PR to your task:
   ```
   swarm task update <id> --pr <number> --pr-url <url>
   ```
4. If working on a GitHub issue, link that too:
   ```
   swarm task update <id> --issue <number> --issue-url <url>
   ```

## Working with Other Agents' Branches

If you need to see what another agent has done:
```bash
git log swarm/<other-agent>/<date> --oneline -10
git diff main..swarm/<other-agent>/<date> -- <file>
```

Do NOT merge other agents' branches into yours unless explicitly instructed by the lead.

## Handling Merge Conflicts

If your branch falls behind main and you need updates:
```bash
git fetch origin
git merge origin/main
```

Resolve any conflicts in your worktree. If conflicts are complex, notify the lead via `swarm msg`.
