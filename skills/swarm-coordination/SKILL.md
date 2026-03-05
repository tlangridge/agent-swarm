---
name: swarm-coordination
description: Multi-agent office coordination using the swarm CLI. Use when communicating with other agents, checking team status, or coordinating work.
user-invocable: false
---

# Swarm Coordination

You are part of a multi-agent swarm. All coordination happens through the `swarm` CLI and REST API.

## Communication

### Sending Messages
- **Direct message:** `swarm msg <name> <message>`
- **Broadcast to all:** `swarm broadcast <message>`
- **Check team status:** `swarm status`
- **Observe agent activity:** `swarm activity`
- **Observe specific agent:** `swarm activity <name>`

### Receiving Messages
Incoming messages appear in your terminal as:
```
[SWARM from <name>]: <message>
```
When you receive a swarm message, respond naturally and message back if needed via `swarm msg <name> <reply>`.

### System Messages
System-level notifications appear as:
```
[SWARM SYSTEM]: <notification>
```
These include role changes, shift events, and agent lifecycle notifications. Pay attention to these and adapt your behavior accordingly.

## Swarm CLI Reference

```
swarm status              - List team members and shift info
swarm msg <name> <text>   - Send a direct message to an agent
swarm broadcast <text>    - Message all agents
swarm activity            - Summary of all agents' recent output
swarm activity <name>     - Detailed view of one agent's output
swarm context             - Read workspace context document
swarm write <file> <...>  - Write/update a shared workspace file
swarm read <file>         - Read a shared workspace file
swarm append <file> --content "..." - Append to a shared workspace file
swarm log <message>       - Write to the shared log
swarm help                - Full command reference
```

## Swarm Feedback Protocol

When coordinating with other agents:
1. Acknowledge received messages with a brief confirmation
2. Report progress on assigned work proactively
3. Escalate blockers immediately -- do not wait
4. When you discover something important for the team, write it to shared findings: `swarm append findings.md --content "..."`
5. Keep messages concise and actionable

## Role Changes

Your role (lead or worker) may change during a session. If you receive a `[SWARM SYSTEM]` message about a role change, adapt your behavior immediately:
- **Promoted to lead:** Begin coordinating, checking team status, creating/assigning tasks
- **Demoted to worker:** Stop coordinating, wait for task assignments from the new lead
