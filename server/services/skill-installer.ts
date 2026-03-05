import type { FunctionalRole } from './swarm-registry.js';

// Maps roles to skill commands agents should invoke via /skill-name
export const ROLE_SKILLS: Partial<Record<FunctionalRole, { skill: string; when: string }[]>> = {
  'designer': [
    { skill: 'frontend-design', when: 'building UI components, pages, or layouts' },
    { skill: 'copywriting', when: 'writing any user-facing text, headlines, or CTAs' },
    { skill: 'humanizer', when: 'reviewing any copy to remove AI-sounding patterns' },
  ],
  'developer': [
    { skill: 'frontend-design', when: 'building frontend components or pages' },
  ],
  'product-manager': [
    { skill: 'copywriting', when: 'writing marketing copy, landing pages, or product descriptions' },
    { skill: 'humanizer', when: 'reviewing any written copy before publishing' },
    { skill: 'seo-content-writer', when: 'writing blog posts, articles, or SEO content' },
    { skill: 'programmatic-seo', when: 'creating SEO template pages at scale' },
  ],
  'architect': [
    { skill: 'frontend-design', when: 'specifying frontend architecture or component designs' },
  ],
  'devops': [
    { skill: 'seo-audit', when: 'auditing site technical SEO or performance' },
  ],
  'tech-lead': [
    { skill: 'find-skills', when: 'you need to discover a skill for a task. Run: npx skills find <query>' },
  ],
};
