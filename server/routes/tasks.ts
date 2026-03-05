import { Router } from 'express';
import { getMember, getMemberByName, getLeadSessionId, recordTaskSuccess, recordTaskFailure, canAcceptTask } from '../services/swarm-registry.js';
import { listTasks, getTask, createTask, updateTask, deleteTask, areDependenciesMet, getReadyTasks, addVerificationRun, checkoutTask, releaseCheckout, getCheckoutLock, getAllCheckoutLocks, isLockStale } from '../services/task-board.js';
import type { CompletionReport, CheckoutLock } from '../services/task-board.js';
import { getActiveShift, getShiftBySessionId, spawnSlotOnDemand } from '../services/shift-manager.js';
import { injectMessage } from '../services/pty-writer.js';
import { sessions } from '../pty-manager.js';
import { isGitRepo, getWorktreeDiffStat, getWorktreeDiffPatch } from '../services/worktree.js';

export const taskRoutes = Router();

/** Annotate tasks with checkout liveness info for the dashboard */
function annotateCheckoutLiveness(tasks: import('../services/task-board.js').TaskItem[]) {
  return tasks.map(task => {
    if (!task.checkoutSessionId) return task;
    const lock = getCheckoutLock(task.id);
    return {
      ...task,
      checkoutLive: sessions.has(task.checkoutSessionId),
      checkoutStale: lock ? isLockStale(lock) : false,
    };
  });
}

// GET /api/swarm/tasks — List tasks (filterable by ?stage=&assignedTo=&status=&priority=)
// No auth required for listing — the UI dashboard polls this endpoint
// Special value: assignedTo=_self resolves to the requesting agent's name
taskRoutes.get('/', async (req, res) => {
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' ? v : Array.isArray(v) ? String(v[0]) : undefined;

  let assignedTo = str(req.query.assignedTo);
  // Resolve _self to the requesting agent's name
  if (assignedTo === '_self') {
    const sessionId = req.headers['x-session-id'] as string | undefined;
    const member = sessionId ? getMember(sessionId) : undefined;
    assignedTo = member?.agentName || undefined;
  }
  const senderSessionIdForOffice = req.headers['x-session-id'] as string | undefined;
  const officeId = str(req.query.officeId) || (senderSessionIdForOffice ? getMember(senderSessionIdForOffice)?.officeId : undefined) || getActiveShift()?.officeId;
  const filters = {
    stage: str(req.query.stage),
    assignedTo,
    status: str(req.query.status),
    priority: str(req.query.priority),
    officeId,
  };

  // ?ready=true returns only open tasks with all dependencies satisfied
  if (req.query.ready === 'true') {
    const tasks = await getReadyTasks(filters);
    return res.json({ tasks: annotateCheckoutLiveness(tasks) });
  }

  const tasks = await listTasks(filters);
  res.json({ tasks: annotateCheckoutLiveness(tasks) });
});

// POST /api/swarm/tasks — Create a task
taskRoutes.post('/', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const sender = getMember(senderSessionId)!;
  const { title, description, stage, assignedTo, priority, context, tags, parentTask, dependsOn, branch, prNumber, prUrl, issueNumber, issueUrl } = req.body;
  if (!title || !stage) {
    return res.status(400).json({ error: "Missing 'title' or 'stage' field" });
  }

  // Validate dependsOn references exist
  if (Array.isArray(dependsOn)) {
    for (const depId of dependsOn) {
      const dep = await getTask(depId);
      if (!dep) {
        return res.status(400).json({ error: `Dependency task '${depId}' not found` });
      }
    }
  }

  const shift = getShiftBySessionId(senderSessionId) ?? getActiveShift(sender.officeId);
  const task = await createTask({
    title,
    description,
    stage,
    assignedTo,
    priority,
    context,
    tags,
    parentTask,
    dependsOn: Array.isArray(dependsOn) ? dependsOn : undefined,
    branch,
    prNumber,
    prUrl,
    issueNumber,
    issueUrl,
    officeId: sender.officeId || shift?.officeId,
    createdBy: sender.agentName || 'Anonymous',
  });

  // Auto-spawn pending slot if task is assigned to one
  if (assignedTo && shift) {
    const pendingSlot = shift.slots.find(
      s => s.name.toLowerCase() === assignedTo.toLowerCase() && s.status === 'pending',
    );
    if (pendingSlot) {
      spawnSlotOnDemand(pendingSlot.slotIndex, shift.officeId).catch(err => {
        console.warn(`Auto-spawn for ${assignedTo} failed:`, err);
      });
    }
  }

  res.status(201).json(task);
});

// PUT /api/swarm/tasks/:id — Update a task
// Accepts either X-Session-Id (agent auth) or X-Dashboard: true (human operator)
taskRoutes.put('/:id', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  const isDashboard = req.headers['x-dashboard'] === 'true';
  if (!isDashboard && (!senderSessionId || !getMember(senderSessionId))) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  // Guard: don't allow reassignment of locked tasks (unless dashboard)
  const { title, description, stage, assignedTo, status, priority, context, tags, parentTask, dependsOn, output, branch, prNumber, prUrl, issueNumber, issueUrl } = req.body;
  if (assignedTo !== undefined) {
    const lock = getCheckoutLock(req.params.id);
    if (lock && lock.sessionId !== senderSessionId && !isDashboard) {
      return res.status(409).json({
        error: 'Task is checked out by another agent',
        checkedOutBy: lock.agentName,
        checkoutSessionId: lock.sessionId,
      });
    }
  }
  const task = await updateTask(req.params.id, { title, description, stage, assignedTo, status, priority, context, tags, parentTask, dependsOn, output, branch, prNumber, prUrl, issueNumber, issueUrl });
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Auto-spawn pending slot if newly assigned
  if (assignedTo) {
    const updateSenderSessionId = senderSessionId;
    const updateShift = updateSenderSessionId
      ? (getShiftBySessionId(updateSenderSessionId) ?? getActiveShift(getMember(updateSenderSessionId)?.officeId))
      : getActiveShift();
    if (updateShift) {
      const pendingSlot = updateShift.slots.find(
        s => s.name.toLowerCase() === assignedTo.toLowerCase() && s.status === 'pending',
      );
      if (pendingSlot) {
        spawnSlotOnDemand(pendingSlot.slotIndex, updateShift.officeId).catch(err => {
          console.warn(`Auto-spawn for ${assignedTo} failed:`, err);
        });
      }
    }
  }

  res.json(task);
});

// POST /api/swarm/tasks/:id/pick — Atomically checkout task + set to in-progress
taskRoutes.post('/:id/pick', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  // Circuit breaker check
  if (!canAcceptTask(senderSessionId)) {
    return res.status(429).json({ error: 'Agent circuit breaker is open due to consecutive failures. Wait for cooldown.' });
  }

  const sender = getMember(senderSessionId)!;
  const result = await checkoutTask(
    req.params.id, senderSessionId, sender.agentName || 'Anonymous',
  );

  if ('conflict' in result) {
    // If sessionId is empty, it's a task-not-found or deps-unmet error
    if (!result.conflict.sessionId) {
      if (result.conflict.agentName.startsWith('deps-unmet:')) {
        const blocking = result.conflict.agentName.replace('deps-unmet:', '').split(',');
        return res.status(409).json({ error: 'Task has unmet dependencies', blocking });
      }
      return res.status(404).json({ error: 'Task not found or not available for pickup' });
    }
    return res.status(409).json({
      error: 'Task is already checked out',
      checkedOutBy: result.conflict.agentName,
      checkoutSessionId: result.conflict.sessionId,
      checkedOutAt: new Date(result.conflict.lockedAt).toISOString(),
    });
  }

  const task = result.task;

  // Inject upstream outputs if this task has dependencies
  if (task.dependsOn && task.dependsOn.length > 0) {
    const upstreamOutputs: string[] = [];
    for (const depId of task.dependsOn) {
      const dep = await getTask(depId);
      if (dep?.output) {
        upstreamOutputs.push(`  "${dep.title}" (${depId}): ${dep.output}`);
      }
    }
    if (upstreamOutputs.length > 0) {
      injectMessage(senderSessionId, `[SWARM SYSTEM]: Upstream task outputs for "${task.title}":\n${upstreamOutputs.join('\n')}`);
    }
  }

  res.json(task);
});

// POST /api/swarm/tasks/:id/done — Mark task done + auto-generate completion report
taskRoutes.post('/:id/done', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const sender = getMember(senderSessionId)!;
  const updates: { status: 'done'; output?: string; completionReport?: CompletionReport } = { status: 'done' };
  if (req.body?.output) updates.output = req.body.output;

  // Auto-generate completion report with diff
  const session = sessions.get(senderSessionId);
  const report: CompletionReport = {
    agent: sender.agentName || 'Unknown',
    generatedAt: new Date().toISOString(),
  };

  if (session) {
    const projectPath = session.projectPath;
    if (projectPath && isGitRepo(projectPath)) {
      try {
        report.branch = session.worktreeBranch || undefined;
        report.diffStat = getWorktreeDiffStat(projectPath);
        report.diffPatch = getWorktreeDiffPatch(projectPath);
      } catch (err) {
        console.warn('Failed to generate diff report:', err);
      }
    }
  }

  // Carry over existing verification runs
  const existingTask = await getTask(req.params.id);
  if (existingTask?.completionReport?.verificationRuns) {
    report.verificationRuns = existingTask.completionReport.verificationRuns;
  }

  updates.completionReport = report;
  const task = await updateTask(req.params.id, updates);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Release checkout lock on completion
  await releaseCheckout(req.params.id, senderSessionId);

  recordTaskSuccess(senderSessionId);

  // Notify lead with structured completion summary
  const leadSessionId = getLeadSessionId(sender.officeId || undefined);
  if (leadSessionId && leadSessionId !== senderSessionId) {
    const lines: string[] = [`[TASK COMPLETED]: "${task.title}" by ${sender.agentName}`];
    if (report.branch) lines.push(`  Branch: ${report.branch}`);
    if (report.diffStat) {
      lines.push(`  Changes: ${report.diffStat.filesChanged} file${report.diffStat.filesChanged !== 1 ? 's' : ''} (+${report.diffStat.insertions} -${report.diffStat.deletions})`);
      if (report.diffStat.files.length > 0) {
        lines.push(`  Files: ${report.diffStat.files.slice(0, 10).join(', ')}${report.diffStat.files.length > 10 ? ` (+${report.diffStat.files.length - 10} more)` : ''}`);
      }
    }
    if (report.verificationRuns && report.verificationRuns.length > 0) {
      const lastRun = report.verificationRuns[report.verificationRuns.length - 1];
      lines.push(`  Verification: \`${lastRun.command}\` -> exit ${lastRun.exitCode}`);
    }
    if (task.output) lines.push(`  Summary: ${task.output.slice(0, 200)}`);
    injectMessage(leadSessionId, lines.join('\n'));
  }

  // Check for newly unblocked tasks and notify agents
  const allTasks = await listTasks({ officeId: task.officeId });
  const nowReady: Array<{ id: string; title: string; assignedTo?: string }> = [];
  for (const t of allTasks) {
    if (t.status !== 'open' || !t.dependsOn?.includes(task.id)) continue;
    const { met } = await areDependenciesMet(t.id);
    if (met) nowReady.push({ id: t.id, title: t.title, assignedTo: t.assignedTo });
  }

  if (nowReady.length > 0) {
    for (const ready of nowReady) {
      if (ready.assignedTo) {
        const target = getMemberByName(ready.assignedTo, sender.officeId || undefined);
        if (target) {
          injectMessage(target.sessionId, `[SWARM SYSTEM]: Task "${ready.title}" (${ready.id}) is now unblocked — all dependencies are complete.`);
        }
      }
    }
    if (leadSessionId) {
      const titles = nowReady.map(t => `"${t.title}" (${t.id})`).join(', ');
      injectMessage(leadSessionId, `[SWARM SYSTEM]: ${nowReady.length} task(s) unblocked: ${titles}`);
    }
  }

  res.json(task);
});

// POST /api/swarm/tasks/:id/fail — Mark task as blocked/failed + record failure
taskRoutes.post('/:id/fail', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const reason = req.body?.reason || 'No reason given';
  const task = await updateTask(req.params.id, { status: 'blocked' });
  if (!task) return res.status(404).json({ error: 'Task not found' });

  // Release checkout lock on failure
  await releaseCheckout(req.params.id, senderSessionId);

  recordTaskFailure(senderSessionId);

  // Notify lead about the failure
  const sender = getMember(senderSessionId)!;
  const leadSessionId = getLeadSessionId(sender.officeId || undefined);
  if (leadSessionId && leadSessionId !== senderSessionId) {
    injectMessage(leadSessionId, `[SWARM SYSTEM]: ${sender.agentName} failed task "${task.title}" (${task.id}): ${reason}`);
  }

  res.json({ ...task, reason });
});

// POST /api/swarm/tasks/:id/verify — Record a verification run on a task
taskRoutes.post('/:id/verify', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const { command, exitCode, outputSnippet, ranAt } = req.body;
  if (!command || exitCode === undefined) {
    return res.status(400).json({ error: "Missing 'command' or 'exitCode' field" });
  }

  const task = await addVerificationRun(req.params.id, {
    command,
    exitCode: Number(exitCode),
    outputSnippet: outputSnippet || '',
    ranAt: ranAt || new Date().toISOString(),
  });

  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

// POST /api/swarm/tasks/:id/release — Force-release a checkout lock (lead or dashboard only)
taskRoutes.post('/:id/release', async (req, res) => {
  const isDashboard = req.headers['x-dashboard'] === 'true';
  const senderSessionId = req.headers['x-session-id'] as string | undefined;

  // Only dashboard or the lead can force-release
  if (!isDashboard && senderSessionId) {
    const sender = getMember(senderSessionId);
    if (!sender || sender.role !== 'lead') {
      return res.status(403).json({ error: 'Only the lead or dashboard can force-release' });
    }
  } else if (!isDashboard && !senderSessionId) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const released = await releaseCheckout(req.params.id);
  if (!released) return res.status(404).json({ error: 'No active checkout on this task' });

  const task = await getTask(req.params.id);
  res.json({ released: true, task });
});

// GET /api/swarm/tasks/locks — List all active checkout locks
taskRoutes.get('/locks', (_req, res) => {
  const locks = getAllCheckoutLocks().map(lock => ({
    ...lock,
    stale: isLockStale(lock),
    sessionAlive: sessions.has(lock.sessionId),
    lockedAtISO: new Date(lock.lockedAt).toISOString(),
  }));
  res.json({ locks });
});

// DELETE /api/swarm/tasks/:id — Delete a task
taskRoutes.delete('/:id', async (req, res) => {
  const senderSessionId = req.headers['x-session-id'] as string | undefined;
  if (!senderSessionId || !getMember(senderSessionId)) {
    return res.status(401).json({ error: 'Invalid or missing X-Session-Id header' });
  }

  const deleted = await deleteTask(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Task not found' });

  res.json({ deleted: true });
});
