#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const chartPath = join(repoRoot, 'personalities', 'org-chart.json');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function parseFrontmatter(path) {
  const text = readFileSync(path, 'utf8');
  if (!text.startsWith('---\n')) return {};
  const end = text.indexOf('\n---', 4);
  if (end === -1) return {};
  const block = text.slice(4, end).trim();
  const out = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    if (value === 'null') value = null;
    out[m[1]] = value;
  }
  return out;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function fail(message) {
  throw new Error(message);
}

export function validateOrgChart(chart = readJson(chartPath), options = {}) {
  const root = options.repoRoot || repoRoot;
  const errors = [];
  const warnings = [];
  const nodes = [];
  const seen = new Set();
  const validParents = new Set();

  function addNode(node, kind) {
    if (!node || typeof node !== 'object') {
      errors.push(`${kind}: node must be an object`);
      return;
    }
    if (!node.id) errors.push(`${kind}: missing id`);
    if (!node.name) errors.push(`${node.id || kind}: missing name`);
    if (!node.personality_path) errors.push(`${node.id || kind}: missing personality_path`);
    if (node.id && seen.has(node.id)) errors.push(`${node.id}: duplicate agent id`);
    if (node.id) seen.add(node.id);
    nodes.push({ ...node, kind });
  }

  addNode(chart.ceo, 'ceo');
  if (chart.ceo && chart.ceo.id) validParents.add(chart.ceo.id);
  for (const director of asArray(chart.directors)) {
    addNode(director, 'director');
    if (director.id) validParents.add(director.id);
  }
  for (const agent of asArray(chart.agents)) addNode(agent, 'agent');

  for (const director of asArray(chart.directors)) {
    if (director.reports_to !== chart.ceo?.id) {
      errors.push(`${director.id}: director reports_to must be ${chart.ceo?.id}`);
    }
    for (const memberId of asArray(director.members)) {
      const member = nodes.find((node) => node.id === memberId);
      if (!member) errors.push(`${director.id}: members includes unknown id ${memberId}`);
      if (member && member.reports_to !== director.id) {
        errors.push(`${director.id}: member ${memberId} reports_to is ${member.reports_to || 'missing'}`);
      }
    }
  }

  for (const node of nodes) {
    if (node.kind !== 'ceo' && !validParents.has(node.reports_to)) {
      errors.push(`${node.id}: reports_to must reference ceo/director id`);
    }

    const chain = node.harness_chain || chart.defaults?.harness_chain;
    if (!Array.isArray(chain) || chain.length === 0) {
      errors.push(`${node.id}: harness_chain must be a non-empty array`);
    } else if (chain.some((runtime) => typeof runtime !== 'string' || runtime.trim() === '')) {
      errors.push(`${node.id}: harness_chain entries must be non-empty strings`);
    }

    const personalityPath = node.personality_path && join(root, node.personality_path);
    if (!personalityPath || !existsSync(personalityPath)) {
      errors.push(`${node.id}: personality file missing at ${node.personality_path}`);
      continue;
    }

    const frontmatter = parseFrontmatter(personalityPath);
    if (frontmatter.agent_id && frontmatter.agent_id !== node.id) {
      errors.push(`${node.id}: personality frontmatter agent_id is ${frontmatter.agent_id}`);
    }
    if (frontmatter.reports_to != null && frontmatter.reports_to !== node.reports_to) {
      // Older charters used Jarvis as the CEO id before the org chart renamed
      // the top node to Argus. Keep that compatibility visible without making
      // every check fail until the charters are deliberately revised.
      if (frontmatter.reports_to === 'jarvis' && node.reports_to === chart.ceo?.id) {
        warnings.push(`${node.id}: personality frontmatter still says reports_to jarvis; org chart uses ${chart.ceo.id}`);
      } else {
        errors.push(`${node.id}: personality frontmatter reports_to is ${frontmatter.reports_to}`);
      }
    }
    if (!frontmatter.agent_id) warnings.push(`${node.id}: personality frontmatter missing agent_id`);
  }

  return {
    ok: errors.length === 0,
    counts: {
      ceo: chart.ceo ? 1 : 0,
      directors: asArray(chart.directors).length,
      agents: asArray(chart.agents).length,
      total: nodes.length,
    },
    errors,
    warnings,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = validateOrgChart();
    if (!result.ok) fail(result.errors.join('\n'));
    const warningSuffix = result.warnings.length ? ` (${result.warnings.length} warning(s))` : '';
    console.log(`org-chart ok: ${result.counts.total} nodes, ${result.counts.directors} directors, ${result.counts.agents} ICs${warningSuffix}`);
    for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  } catch (err) {
    console.error(`org-chart invalid: ${err.message}`);
    process.exitCode = 1;
  }
}
