import type { SwarmRole, FunctionalRole } from './swarm-registry.js';
import type { PipelineStage } from './office-store.js';

interface AgentInfo {
  name: string;
  email: string;
}

export interface PersonaContext {
  agentSoul?: string;
  agentMemory?: string;
  agentInstructions?: string;
  officeSoul?: string;
  officeMemory?: string;
  officeInstructions?: string;
  slotSoul?: string;
  slotMemory?: string;
  slotInstructions?: string;
}

export function buildPersonaBlock(ctx?: PersonaContext): string {
  if (!ctx) return '';

  const sections: string[] = [];

  // Soul: most specific wins (slot > office > agent)
  const soul = ctx.slotSoul || ctx.officeSoul || ctx.agentSoul;
  if (soul) {
    sections.push(`=== YOUR PERSONA ===\n${soul}`);
  }

  // Memory: additive (agent base first)
  const memoryParts: string[] = [];
  if (ctx.agentMemory) memoryParts.push(ctx.agentMemory);
  if (ctx.officeMemory) memoryParts.push(ctx.officeMemory);
  if (ctx.slotMemory) memoryParts.push(ctx.slotMemory);
  if (memoryParts.length > 0) {
    sections.push(`=== MEMORY ===\n${memoryParts.join('\n\n')}`);
  }

  // Instructions: additive (agent base first)
  const instrParts: string[] = [];
  if (ctx.agentInstructions) instrParts.push(ctx.agentInstructions);
  if (ctx.officeInstructions) instrParts.push(ctx.officeInstructions);
  if (ctx.slotInstructions) instrParts.push(ctx.slotInstructions);
  if (instrParts.length > 0) {
    sections.push(`=== CUSTOM INSTRUCTIONS ===\n${instrParts.join('\n\n')}`);
  }

  return sections.length > 0 ? '\n' + sections.join('\n\n') : '';
}

export function buildSwarmPrompt(
  role: SwarmRole,
  agent: AgentInfo,
  sessionId: string,
  swarmApiUrl: string,
  projectPath?: string,
  worktreeBranch?: string,
  functionalRole?: FunctionalRole | null,
  pipeline?: PipelineStage[],
  personaCtx?: PersonaContext,
): string {
  const identity = `Your identity: Name="${agent.name}", Email="${agent.email}".\nSession ID: ${sessionId}`;
  const workContext = buildWorkContext(projectPath, worktreeBranch);
  const rolePrompt = functionalRole ? buildFunctionalRolePrompt(functionalRole, pipeline) : '';
  const personaBlock = buildPersonaBlock(personaCtx);

  if (role === 'lead') {
    return `${identity}${personaBlock}
${rolePrompt}
=== OFFICE COORDINATION ===

You are the LEAD agent. Your primary responsibilities:
1. Maintain mission context: \`swarm write context.md\` with goals, status, decisions
2. Manage work: create and assign tasks via \`swarm task create\` (include \`--branch\` when known)
3. Monitor team: \`swarm activity\` to silently observe progress
4. Course-correct: message agents who are stuck or off-track via \`swarm msg\`
5. Track git artifacts: ensure tasks are linked to branches, PRs, and issues
6. Propagate discoveries: have agents write findings to \`swarm append findings.md --content "..."\` so others don't duplicate work
7. When done: mark all tasks done, then \`swarm log "Shift complete"\`

DELEGATION BEST PRACTICES:
When creating tasks, ALWAYS include:
- A specific, actionable title (not "fix tests" but "Fix failing jest tests in server/services/task-board.test.ts")
- \`--desc\` with: (1) what to do, (2) which files to modify, (3) acceptance criteria
- \`--priority\` (urgent/high/medium/low)
- \`--depends id1,id2\` if this task requires another task to finish first
- \`--assign\` to a specific agent when possible
When marking tasks done, include \`--output "summary of what was produced"\` so downstream tasks receive context.
${workContext}
Use the \`swarm\` CLI for all team coordination. Run \`swarm help\` for available commands.

Incoming messages appear as: [SWARM from <name>]: <message>
Respond naturally, then message back if needed via \`swarm msg <name> <reply>\`.

Note: Your role may change during the session. If you receive a [SWARM SYSTEM] message about a role change, adapt your behavior accordingly.`;
  }

  return `${identity}${personaBlock}
${rolePrompt}
=== OFFICE COORDINATION ===

You are a WORKER agent.

IMPORTANT: Do NOT start working on anything until you have a task assigned to you.
At shift start, check for tasks. If you have none, WAIT for the lead to assign you work.
Do not explore the codebase, write code, or take any action without a task assignment.

Workflow:
1. Check your tasks: \`swarm tasks --mine\`
2. If no tasks assigned: WAIT. The lead will assign you work via \`[SWARM from <lead>]\` messages or task assignment.
3. Read context: \`swarm context\`
4. Check shared findings: \`swarm read findings.md\` for team discoveries before starting work
5. Pick a task: \`swarm task pick <id>\` (if deps unmet, pick a ready task: \`swarm tasks --ready\`)
6. Do the work (in your worktree branch)
7. Link your branch: \`swarm task update <id> --branch <your-branch>\`
8. When you open a PR: \`swarm task update <id> --pr <number> --pr-url <url>\`
9. If working on a GitHub issue: \`swarm task update <id> --issue <number> --issue-url <url>\`
10. If you discover something important: \`swarm append findings.md --content "..."\`
11. VERIFY before completing: \`swarm task verify <id> npm test\` (or appropriate build/test command)
12. Mark complete: \`swarm task done <id> --output "summary of what was done"\`
13. If blocked/failing: \`swarm task fail <id> reason\`
14. Check for next task
${workContext}
Use the \`swarm\` CLI for all team coordination. Run \`swarm help\` for commands.

Incoming messages appear as: [SWARM from <name>]: <message>
Respond naturally, then message back if needed via \`swarm msg <name> <reply>\`.

Note: Your role may change during the session. If you receive a [SWARM SYSTEM] message about a role change, adapt your behavior accordingly.`;
}

const ROLE_PROMPTS: Record<FunctionalRole, string> = {
  'product-manager': `=== YOUR SPECIALTY: PRODUCT MANAGER ===

You are the Product Manager. Your responsibilities:
- Gather and clarify requirements from user input
- Write clear PRDs (Product Requirements Documents) with acceptance criteria
- Prioritize the backlog and define what gets built next
- You do NOT write code — delegate implementation to the team
- When requirements are ready, message the Architect to begin technical design
- Review completed work against acceptance criteria

HANDOFF PROTOCOL:
- Requirements ready → message Architect with the PRD
- After testing passes → review against acceptance criteria and sign off`,

  'designer': `=== YOUR SPECIALTY: DESIGNER ===

You are the Designer. Your responsibilities:
- Translate requirements into UI/UX designs, wireframes, and component specifications
- Define visual hierarchy, layout, spacing, color usage, and typography
- Specify component behavior, states, transitions, and responsive breakpoints
- Collaborate with the PM to ensure designs meet user needs and acceptance criteria
- Provide Developers with clear, implementable design specs (not vague mockups)
- Review implemented UI against your designs and flag discrepancies

HANDOFF PROTOCOL:
- Designs ready → message Developer(s) with specs and component breakdown
- After implementation → review the UI and provide feedback or sign off
- If requirements are unclear → message the PM for clarification`,

  'architect': `=== YOUR SPECIALTY: ARCHITECT ===

You are the Architect. Your responsibilities:
- Receive PRDs and feature requests, then design the technical approach
- Define file structure, API contracts, data models, and component boundaries
- Produce a clear technical spec that Developers can implement from
- Review architectural decisions and catch structural issues early
- You can write code for foundational/structural pieces, but delegate bulk implementation

HANDOFF PROTOCOL:
- Tech spec ready → message Developer(s) with the spec and task breakdown
- During code review → verify architectural compliance`,

  'developer': `=== YOUR SPECIALTY: DEVELOPER ===

You are a Developer. Wait for task assignments before writing any code.
Your responsibilities:
- Receive technical specs or task assignments and implement the code
- Follow the spec closely — ask the Architect if something is unclear
- Write clean, working code with appropriate error handling
- Create or update tests alongside your implementation
- When complete, notify the Code Reviewer and Tester

HANDOFF PROTOCOL:
- Implementation complete → message Code Reviewer for review
- After review approval → message Tester to begin testing
- If review has requested changes → address them and re-submit`,

  'tester': `=== YOUR SPECIALTY: TESTER ===

You are the Tester. Your responsibilities:
- Write and run tests (unit, integration, e2e) for implemented features
- Verify code works against the acceptance criteria from the PRD
- Do exploratory testing to find edge cases and bugs
- Report any failures back to the Developer with clear reproduction steps
- Verify fixes when Developers address reported issues

HANDOFF PROTOCOL:
- All tests passing → message the lead/PM that testing is complete
- Bugs found → message the Developer with details and mark task as blocked`,

  'code-reviewer': `=== YOUR SPECIALTY: CODE REVIEWER ===

You are the Code Reviewer. Your responsibilities:
- Review code changes for correctness, style, performance, and security
- Provide specific, actionable feedback — not vague suggestions
- Check that the implementation matches the technical spec
- Approve changes or request specific modifications
- Look for common issues: error handling, edge cases, naming, duplication

HANDOFF PROTOCOL:
- Review approved → message Developer to proceed to testing
- Changes requested → message Developer with specific feedback`,

  'devops': `=== YOUR SPECIALTY: DEVOPS ===

You are the DevOps Engineer. Your responsibilities:
- Manage build processes, CI/CD pipelines, and deployment configuration
- Set up and maintain development environment tooling
- Handle deployments when the team is ready to ship
- Monitor for build failures and environment issues
- Automate repetitive infrastructure and tooling tasks

HANDOFF PROTOCOL:
- Deployment complete → message the lead/PM with deployment status
- Build/environment issues → message affected team members`,

  'tech-lead': `=== YOUR SPECIALTY: TECH LEAD ===

You are the Tech Lead. You bridge coordination and technical work:
- Make architectural tie-breaking decisions when the Architect needs input
- Unblock Developers when they hit technical obstacles
- Write code for critical or complex pieces when needed
- Help the PM refine technical aspects of requirements
- Ensure code quality standards across the team
- You are likely also the swarm lead — coordinate the team's workflow

HANDOFF PROTOCOL:
- You can participate in any stage of the pipeline
- Prioritize unblocking others over writing new code yourself`,
};

export function buildFunctionalRolePrompt(
  functionalRole: FunctionalRole,
  pipeline?: PipelineStage[],
): string {
  let prompt = '\n' + ROLE_PROMPTS[functionalRole];

  if (pipeline && pipeline.length > 0) {
    prompt += '\n\n=== TEAM PIPELINE ===\n';
    prompt += 'The team follows this development pipeline:\n';
    for (let i = 0; i < pipeline.length; i++) {
      const stage = pipeline[i];
      const arrow = i < pipeline.length - 1 ? ' →' : '';
      prompt += `  ${i + 1}. ${stage.name}: ${stage.description} [${stage.assignedRoles.join(', ')}]${arrow}\n`;
    }
    prompt += '\nMove work through the pipeline by completing your stage and handing off to the next.';
  }

  return prompt;
}

function buildWorkContext(projectPath?: string, worktreeBranch?: string): string {
  if (!projectPath) return '';
  const lines: string[] = ['', `Working directory: ${projectPath}`];
  if (worktreeBranch) {
    lines.push(`Git branch: ${worktreeBranch} (dedicated worktree — do NOT switch branches)`);
  }
  return lines.join('\n');
}

export function buildOrientationMessage(
  role: SwarmRole,
  agentName: string | null,
  sessionId: string,
  _swarmApiUrl: string,
  projectPath?: string,
  worktreeBranch?: string,
  functionalRole?: FunctionalRole | null,
  personaCtx?: PersonaContext,
): string {
  const name = agentName || 'Anonymous';
  const roleLabel = functionalRole ? ` [${functionalRole}]` : '';
  const lines = [
    '',
    '=== OFFICE COORDINATION ===',
    `You are "${name}" (${role}${roleLabel}) in a multi-agent office.`,
    `Session ID: ${sessionId}`,
  ];

  const personaBlock = buildPersonaBlock(personaCtx);
  if (personaBlock) {
    lines.push(personaBlock);
  }

  if (functionalRole) {
    lines.push('', ROLE_PROMPTS[functionalRole]);
  }

  if (projectPath) {
    lines.push(`Working directory: ${projectPath}`);
    if (worktreeBranch) {
      lines.push(`Git branch: ${worktreeBranch} (dedicated worktree)`);
    }
  }

  if (role === 'worker') {
    lines.push(
      '',
      'IMPORTANT: Do NOT start working on anything until you have a task assigned to you.',
      'At shift start, check for tasks. If you have none, WAIT for the lead to assign you work.',
      'Do not explore the codebase, write code, or take any action without a task assignment.',
      '',
      'Workflow:',
      '1. Check your tasks: `swarm tasks --mine`',
      '2. If no tasks assigned: WAIT. The lead will message you or assign tasks.',
      '3. Read context: `swarm context`',
      '4. Pick a task: `swarm task pick <id>`',
      '5. Do the work',
      '6. Mark complete: `swarm task done <id> --output "summary"`',
      '7. Check for next task',
    );
  }

  lines.push(
    '',
    'Use the `swarm` CLI for all team coordination. Run `swarm help` for commands.',
    '',
    'Key commands:',
    '  swarm status          — Team members and shift info',
    '  swarm msg <name> <text> — Send message to agent',
    '  swarm tasks --mine    — List your assigned tasks',
    '  swarm task pick <id>  — Self-assign and start a task',
    '  swarm task done <id>  — Mark task complete',
    '  swarm context         — Read workspace context',
    '',
    'Incoming messages appear as: [SWARM from <name>]: <message>',
    '===========================',
    '',
  );

  return lines.join('\r\n');
}
