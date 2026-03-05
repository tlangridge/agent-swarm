import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SwarmRole, FunctionalRole } from './swarm-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.join(__dirname, '../../skills');

export interface SkillMeta {
  name: string;
  description: string;
  path: string;  // absolute path to skill directory
}

// Simple regex-based frontmatter parser (no YAML library needed)
function parseFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  return {
    name: yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
    description: yaml.match(/^description:\s*(.+)$/m)?.[1]?.trim(),
  };
}

let cachedSkills: SkillMeta[] | null = null;

/** Scan the skills/ directory and return metadata for all discovered skills */
export function discoverSkills(): SkillMeta[] {
  if (cachedSkills) return cachedSkills;

  const skills: SkillMeta[] = [];

  if (!fs.existsSync(SKILLS_DIR)) {
    console.warn('Skills directory not found:', SKILLS_DIR);
    return skills;
  }

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillFile = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, 'utf-8');
      const meta = parseFrontmatter(content);

      skills.push({
        name: meta.name || entry.name,
        description: meta.description || '',
        path: skillDir,
      });
    } catch (err) {
      console.warn(`Failed to read skill ${entry.name}:`, err);
    }
  }

  cachedSkills = skills;
  return skills;
}

/** Invalidate the cached skill list (useful if skills are added at runtime) */
export function invalidateSkillCache(): void {
  cachedSkills = null;
}

// ── Role-to-skill mapping ────────────────────────────────────────────────────

const BASE_SKILLS = ['swarm-coordination', 'task-management', 'context-conservation'];

const SWARM_ROLE_SKILLS: Record<SwarmRole, string[]> = {
  lead: [...BASE_SKILLS, 'lead-agent', 'shift-protocol'],
  worker: [...BASE_SKILLS, 'worker-agent'],
};

const FUNCTIONAL_ROLE_EXTRAS: Partial<Record<FunctionalRole, string[]>> = {
  'code-reviewer': ['code-review'],
  'developer': ['git-worktree'],
  'architect': ['git-worktree'],
  'tech-lead': ['lead-agent', 'shift-protocol'],
};

/** Get the default skill set for a given swarm role and optional functional role */
export function getDefaultSkills(
  swarmRole: SwarmRole,
  functionalRole?: FunctionalRole | null,
): string[] {
  const skills = new Set(SWARM_ROLE_SKILLS[swarmRole] || BASE_SKILLS);

  if (functionalRole) {
    const extras = FUNCTIONAL_ROLE_EXTRAS[functionalRole];
    if (extras) {
      for (const s of extras) skills.add(s);
    }
  }

  return Array.from(skills);
}

/** Resolve skill names to their absolute directory paths, filtering out missing skills */
export function resolveSkillPaths(skillNames: string[]): string[] {
  const available = discoverSkills();
  const byName = new Map(available.map(s => [s.name, s.path]));

  const paths: string[] = [];
  for (const name of skillNames) {
    const skillPath = byName.get(name);
    if (skillPath) {
      paths.push(skillPath);
    } else {
      console.warn(`Skill "${name}" not found in skills directory`);
    }
  }
  return paths;
}

/** List all available skills (for the /api/skills endpoint) */
export function listAvailableSkills(): SkillMeta[] {
  return discoverSkills();
}
