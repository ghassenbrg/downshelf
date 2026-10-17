/**
 * Rules engine: a rule is an ordered list entry with one or more conditions
 * (all must match) and a destination folder. The first enabled matching rule
 * in list order wins — the same model as email filters, so it's predictable.
 * Helpers here keep that order sensible: new rules are slotted above any rule
 * that would otherwise swallow them, and shadowed rules are flagged.
 */
import { joinPath, resolveDestination, validateDestination } from './destination.js';
import { getFileType } from './filetypes.js';
import {
  conditionCovers,
  conditionSpecificity,
  describeCondition,
  detectField,
  FIELDS,
  normalizeCondition,
  normalizeHost,
  testCondition,
  validateCondition,
} from './patterns.js';

export const SOURCE_LABELS = {
  download: 'download link',
  redirect: 'final download URL',
  page: 'page you downloaded from',
};

// ---------------------------------------------------------------------------
// Download context

function parseSource(raw, role) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  if (text.startsWith('blob:')) text = text.slice(5);
  if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (!url.hostname) return null;
    let path = url.pathname;
    try {
      path = decodeURIComponent(path);
    } catch {
      // keep the encoded path
    }
    return { role, host: normalizeHost(url.hostname), path, search: url.search, href: url.href };
  } catch {
    return null;
  }
}

function basename(path) {
  return (
    String(path ?? '')
      .split(/[/\\]/)
      .pop() ?? ''
  );
}

function filenameFromUrl(source) {
  if (!source) return '';
  return basename(source.path);
}

/**
 * Builds the matching context for a download. Accepts the fields of a
 * chrome.downloads.DownloadItem (url, finalUrl, referrer, filename, mime).
 */
export function createContext({ url, finalUrl, referrer, filename, mime, date } = {}) {
  const sources = [];
  const seen = new Set();
  for (const [raw, role] of [
    [url, 'download'],
    [finalUrl, 'redirect'],
    [referrer, 'page'],
  ]) {
    const source = parseSource(raw, role);
    if (!source) continue;
    const key = source.host + source.path + source.search;
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  const name =
    basename(filename) ||
    filenameFromUrl(sources.find((s) => s.role === 'redirect')) ||
    filenameFromUrl(sources[0]) ||
    'download';
  return { sources, filename: name, mime: String(mime ?? ''), date: date ?? new Date() };
}

// ---------------------------------------------------------------------------
// Rule helpers

export function newId() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

export function createRule({ name = '', conditions = [], destination = '', enabled = true } = {}) {
  return {
    id: newId(),
    name: String(name).trim(),
    enabled: Boolean(enabled),
    conditions: conditions.map(normalizeCondition),
    destination: validateDestination(destination).value,
  };
}

/** Returns `{ conditions: [error|null], destination: error|null, valid }`. */
export function validateRule(rule) {
  const conditions = (rule.conditions ?? []).map(validateCondition);
  const destination = validateDestination(rule.destination).error;
  const empty = (rule.conditions ?? []).length === 0;
  return {
    conditions,
    destination,
    empty: empty ? 'Add at least one condition.' : null,
    valid: !empty && !destination && conditions.every((e) => e === null),
  };
}

/** A readable name for a rule that wasn't given one. */
export function ruleTitle(rule) {
  if (rule.name) return rule.name;
  const parts = (rule.conditions ?? []).map((c) =>
    c.field === 'filetype'
      ? c.pattern
          .split(', ')
          .map((id) => getFileType(id)?.label ?? id)
          .join(', ')
      : c.pattern,
  );
  return parts.join(' + ') || 'Untitled rule';
}

export function describeRule(rule) {
  return (rule.conditions ?? []).map(describeCondition).join(', and ');
}

// ---------------------------------------------------------------------------
// Matching

export function evaluateRule(rule, ctx) {
  const conditions = (rule.conditions ?? []).map((c) => testCondition(c, ctx));
  const matched = conditions.length > 0 && conditions.every((r) => r.ok);
  return { matched, conditions, source: conditions.find((r) => r.source)?.source };
}

/**
 * Decides where a download goes.
 * Returns `{ rule, index, folder, path, source, evaluations }`; `rule` is null
 * when nothing matched (the download is left alone).
 */
export function route(rules, ctx) {
  const evaluations = [];
  let winner = null;
  rules.forEach((rule, index) => {
    if (!rule.enabled) {
      evaluations.push({ rule, index, skipped: true, matched: false, conditions: [] });
      return;
    }
    if (!validateRule(rule).valid) {
      evaluations.push({ rule, index, invalid: true, matched: false, conditions: [] });
      return;
    }
    const result = { rule, index, ...evaluateRule(rule, ctx) };
    evaluations.push(result);
    if (result.matched && !winner) winner = result;
  });
  if (!winner) {
    return { rule: null, index: -1, folder: '', path: ctx.filename, evaluations };
  }
  const folder = resolveDestination(winner.rule.destination, ctx, winner.source);
  return {
    rule: winner.rule,
    index: winner.index,
    folder,
    path: joinPath(folder, ctx.filename),
    source: winner.source,
    evaluations,
  };
}

// ---------------------------------------------------------------------------
// Ordering

export function specificity(rule) {
  const scores = (rule.conditions ?? []).map(conditionSpecificity);
  return scores.length * 10000 + scores.reduce((a, b) => a + b, 0);
}

/** True when every download `later` could match is caught by `earlier`. */
export function covers(earlier, later) {
  const a = earlier.conditions ?? [];
  const b = later.conditions ?? [];
  if (a.length === 0 || b.length === 0) return false;
  return a.every((ca) => b.some((cb) => conditionCovers(ca, cb)));
}

/**
 * Maps rule id → the earlier enabled rule that makes it unreachable.
 * Only enabled, valid rules are considered on both sides.
 */
export function findShadowed(rules) {
  const shadowed = new Map();
  const active = rules.filter((r) => r.enabled && validateRule(r).valid);
  active.forEach((rule, i) => {
    const blocker = active.slice(0, i).find((earlier) => covers(earlier, rule));
    if (blocker) shadowed.set(rule.id, blocker.id);
  });
  return shadowed;
}

/**
 * Where to insert a new rule: above the first rule that is less specific or
 * that would otherwise catch everything the new rule matches.
 */
export function insertionIndex(rules, rule) {
  const score = specificity(rule);
  const index = rules.findIndex(
    (existing) => (existing.enabled && covers(existing, rule)) || specificity(existing) < score,
  );
  return index === -1 ? rules.length : index;
}

/** Most specific first; ties keep their current order. */
export function sortBySpecificity(rules) {
  return rules
    .map((rule, index) => ({ rule, index, score: specificity(rule) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ rule }) => rule);
}

// ---------------------------------------------------------------------------
// Shorthand: `*.github.com & *.pdf → Development/GitHub`

const ARROW = /\s*(?:→|->|=>)\s*/;

/**
 * Parses one line of shorthand. Conditions are separated by " & ", fields
 * are auto-detected (or forced with `site:`, `url:`, `file:`, `type:`).
 * Returns `{ rule, error }`.
 */
export function parseShorthand(line) {
  const text = String(line ?? '').trim();
  if (!text) return { rule: null, error: 'Type a pattern, an arrow, and a folder.' };
  const parts = text.split(ARROW);
  if (parts.length !== 2) {
    return {
      rule: null,
      error: 'Use an arrow between the pattern and the folder, e.g. *.pdf → PDFs',
    };
  }
  const [left, right] = parts;
  if (!right.trim()) {
    return {
      rule: null,
      error: 'Add a folder after the arrow (type “Downloads” for the top level).',
    };
  }
  const conditions = left
    .split(/\s+&\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => normalizeCondition(detectField(part)));
  const rule = createRule({ conditions, destination: right });
  const check = validateRule({ ...rule, destination: right });
  const error = check.empty ?? check.conditions.find(Boolean) ?? check.destination;
  return { rule, error: error ?? null };
}

export function toShorthand(rule) {
  const left = rule.conditions
    .map(({ field, pattern }) => {
      const detected = detectField(pattern);
      const needsPrefix =
        detected.field !== field || (field === 'filetype' && detected.pattern !== pattern);
      const prefix = { site: 'site', url: 'url', filename: 'file', filetype: 'type' }[field];
      return needsPrefix ? `${prefix}:${pattern}` : pattern;
    })
    .join(' & ');
  return `${left} → ${rule.destination || 'Downloads'}`;
}

// ---------------------------------------------------------------------------
// Import / export

export const EXPORT_FORMAT = 'downshelf-rules';

export function exportRules(rules) {
  return {
    format: EXPORT_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: rules.map(({ name, enabled, conditions, destination }) => ({
      name,
      enabled,
      conditions,
      destination,
    })),
  };
}

/**
 * Accepts an export file object, a bare array of rules, or shorthand text.
 * Returns `{ rules, errors }`; invalid entries are reported, not imported.
 */
export function importRules(input) {
  let data = input;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      const lines = data.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));
      const rules = [];
      const errors = [];
      lines.forEach((line, i) => {
        const { rule, error } = parseShorthand(line);
        if (error) errors.push(`Line ${i + 1}: ${error}`);
        else rules.push(rule);
      });
      if (rules.length === 0 && errors.length === 0) errors.push('The file is empty.');
      return { rules, errors };
    }
  }
  const list = Array.isArray(data) ? data : data?.rules;
  if (!Array.isArray(list))
    return { rules: [], errors: ['This doesn’t look like a Downshelf backup.'] };

  const rules = [];
  const errors = [];
  list.forEach((raw, i) => {
    const conditions = Array.isArray(raw?.conditions)
      ? raw.conditions.filter((c) => c && FIELDS[c.field]).map(normalizeCondition)
      : [];
    const rule = createRule({
      name: typeof raw?.name === 'string' ? raw.name : '',
      enabled: raw?.enabled !== false,
      conditions,
      destination: typeof raw?.destination === 'string' ? raw.destination : '',
    });
    const check = validateRule({ ...rule, destination: raw?.destination });
    const error = check.empty ?? check.conditions.find(Boolean) ?? check.destination;
    if (error) errors.push(`Rule ${i + 1} (${ruleTitle(rule)}): ${error}`);
    else rules.push(rule);
  });
  return { rules, errors };
}
