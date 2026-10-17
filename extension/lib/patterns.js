/**
 * Conditions: a field ("site", "url", "filename", "filetype") plus a pattern.
 *
 * Pattern syntax is deliberately small:
 *   *            matches anything
 *   ?            matches one character (file names only)
 *   a, b         either a or b
 *   *.host.com   host.com and any of its subdomains
 *
 * Everything here is pure and runs both in the extension and under Node.
 */
import { FILE_TYPES, fileTypeMatches, getFileType, KNOWN_EXTENSIONS } from './filetypes.js';

export const FIELDS = {
  site: {
    label: 'Website',
    placeholder: '*.github.com',
    help: 'Matches the site the file comes from, or the page you downloaded it on.',
  },
  url: {
    label: 'URL',
    placeholder: 'github.com/my-org/*',
    help: 'Matches a site plus a path. The scheme (https://) is optional.',
  },
  filename: {
    label: 'File name',
    placeholder: '*.pdf, invoice-*',
    help: 'Matches the name of the downloaded file. Case doesn’t matter.',
  },
  filetype: {
    label: 'File type',
    placeholder: 'Choose a type',
    help: 'Matches a family of files by extension or MIME type.',
  },
};

export const FIELD_IDS = Object.keys(FIELDS);

/** Explicit prefixes accepted in quick-add, e.g. `file:example.com`. */
const PREFIXES = {
  site: 'site',
  host: 'site',
  domain: 'site',
  url: 'url',
  file: 'filename',
  name: 'filename',
  filename: 'filename',
  type: 'filetype',
  filetype: 'filetype',
};

/**
 * Extensions that are more often seen as TLDs (brew.sh, bun.sh). Names
 * ending in these are detected as websites; users can always switch.
 */
const AMBIGUOUS_TLDS = new Set(['sh']);

const HOST_CHARS = /^[a-z0-9*\-.¡-￿]+$/;

// ---------------------------------------------------------------------------
// Parsing helpers

export function splitAlternatives(pattern) {
  return String(pattern ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeRegex(text) {
  return text.replace(/[.+^${}()|[\]\\?*]/g, '\\$&');
}

function globSource(glob, { questionMark = false } = {}) {
  let source = '';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?' && questionMark) source += '.';
    else source += escapeRegex(ch);
  }
  return source;
}

function stripScheme(text) {
  return text.replace(/^[a-z*][a-z0-9+.*-]*:\/\//i, '');
}

export function normalizeHost(host) {
  return String(host ?? '')
    .toLowerCase()
    .replace(/:\d+$/, '')
    .replace(/\.$/, '')
    .replace(/^www\./, '');
}

function hostRegex(pattern) {
  const p = normalizeHost(pattern);
  if (p === '' || p === '*') return /^.*$/;
  if (p.startsWith('*.')) return new RegExp(`^(?:.*\\.)?${globSource(p.slice(2))}$`, 'i');
  return new RegExp(`^${globSource(p)}$`, 'i');
}

/** Splits `https://host/path?q` into host and path parts. */
function splitUrlPattern(pattern) {
  const text = stripScheme(pattern.trim());
  const slash = text.indexOf('/');
  const host = slash === -1 ? text : text.slice(0, slash);
  let path = slash === -1 ? '' : text.slice(slash);
  // `example.com/reports/` and `example.com/reports` both mean "that section".
  path = path.replace(/\/+$/, '');
  return { host: host || '*', path };
}

function pathRegex(path) {
  if (path === '' || path === '/*') return /^.*$/;
  return new RegExp(`^${globSource(path)}(?:/.*)?$`, 'i');
}

// ---------------------------------------------------------------------------
// Detection, normalisation and validation

function looksLikeFileName(alt) {
  if (/^\*\.[^.]+$/.test(alt)) return true; // *.pdf
  const last = alt.slice(alt.lastIndexOf('.') + 1);
  return alt.includes('.') && KNOWN_EXTENSIONS.has(last) && !AMBIGUOUS_TLDS.has(last);
}

function looksLikeHost(alt) {
  return alt === '*' || (HOST_CHARS.test(alt) && alt.includes('.') && !looksLikeFileName(alt));
}

function findFileType(text) {
  const t = text.trim().toLowerCase();
  return FILE_TYPES.find((type) => type.id === t || type.label.toLowerCase() === t) ?? null;
}

/**
 * Guesses which field a free-form pattern targets. Accepts an explicit
 * `field:` prefix. Returns `{ field, pattern }` with the prefix removed.
 */
export function detectField(input) {
  let text = String(input ?? '').trim();
  const prefix = /^([a-z]+):(?!\/\/)\s*/i.exec(text);
  if (prefix && PREFIXES[prefix[1].toLowerCase()]) {
    const field = PREFIXES[prefix[1].toLowerCase()];
    text = text.slice(prefix[0].length);
    return field === 'filetype'
      ? normalizeCondition({ field, pattern: text })
      : { field, pattern: text };
  }
  if (text === '') return { field: 'site', pattern: '' };

  const typeAlts = splitAlternatives(text);
  if (typeAlts.length > 0 && typeAlts.every(findFileType)) {
    return normalizeCondition({ field: 'filetype', pattern: text });
  }

  const lower = text.toLowerCase();
  if (/^[a-z*][a-z0-9+.*-]*:\/\//.test(lower) || lower.includes('/')) {
    return { field: 'url', pattern: text };
  }
  const alts = splitAlternatives(lower);
  if (alts.length > 0 && alts.every(looksLikeHost) && !alts.every((a) => a === '*')) {
    return { field: 'site', pattern: text };
  }
  return { field: 'filename', pattern: text };
}

/** Cleans up a condition the way it should be stored. */
export function normalizeCondition({ field, pattern }) {
  const raw = String(pattern ?? '').trim();
  if (field === 'filetype') {
    const ids = splitAlternatives(raw).map((alt) => findFileType(alt)?.id ?? alt);
    return { field, pattern: [...new Set(ids)].join(', ') };
  }
  const alts = splitAlternatives(raw).map((alt) => {
    if (field === 'site') return stripScheme(alt).replace(/\/+$/, '').toLowerCase();
    if (field === 'url') return stripScheme(alt);
    return alt;
  });
  return { field, pattern: alts.join(', ') };
}

/** Returns a human-readable error, or null when the condition is valid. */
export function validateCondition(condition) {
  const { field, pattern } = normalizeCondition(condition ?? {});
  if (!FIELDS[field]) return 'Choose what to match.';
  const alts = splitAlternatives(pattern);
  if (field === 'filetype') {
    return alts.length > 0 && alts.every(getFileType) ? null : 'Choose a file type.';
  }
  if (alts.length === 0) return 'Enter a pattern.';
  for (const alt of alts) {
    if (/\s/.test(alt) && field !== 'filename') return `“${alt}” contains spaces.`;
    if (field === 'site') {
      if (alt.includes('/')) return 'Websites can’t contain “/”. Switch to URL to match a path.';
      if (!HOST_CHARS.test(alt)) return `“${alt}” isn’t a valid website.`;
      if (
        alt !== '*' &&
        alt !== 'localhost' &&
        !alt.replace(/^\*\./, '').replace(/\*/g, 'x').includes('.')
      ) {
        return `“${alt}” needs a domain, e.g. ${alt}.com`;
      }
    }
    if (field === 'url') {
      const { host } = splitUrlPattern(alt);
      if (!HOST_CHARS.test(host.toLowerCase())) return `“${host}” isn’t a valid website.`;
    }
    if (field === 'filename' && /[/\\]/.test(alt)) {
      return 'File names can’t contain slashes. Switch to URL to match a path.';
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Matching

const compiled = new Map();

function compile({ field, pattern }) {
  const key = `${field}\u0000${pattern}`;
  let matchers = compiled.get(key);
  if (matchers) return matchers;
  matchers = splitAlternatives(pattern).map((alt) => {
    if (field === 'site') {
      const host = hostRegex(stripScheme(alt).replace(/\/+$/, ''));
      return (src) => host.test(src.host);
    }
    if (field === 'url') {
      const parts = splitUrlPattern(alt);
      const host = hostRegex(parts.host);
      const path = pathRegex(parts.path);
      const withQuery = parts.path.includes('?');
      return (src) =>
        host.test(src.host) && path.test(withQuery ? src.path + src.search : src.path);
    }
    if (field === 'filename') {
      const name = new RegExp(`^${globSource(alt, { questionMark: true })}$`, 'i');
      return (_src, ctx) => name.test(ctx.filename);
    }
    return () => false;
  });
  if (compiled.size > 500) compiled.clear();
  compiled.set(key, matchers);
  return matchers;
}

/**
 * Tests one condition against a download context (see createContext).
 * Returns `{ ok, source }` where `source` is the URL source that matched
 * (for site/url conditions).
 */
export function testCondition(condition, ctx) {
  const { field, pattern } = condition;
  if (field === 'filetype') {
    return {
      ok: splitAlternatives(pattern).some((id) => fileTypeMatches(id, ctx.filename, ctx.mime)),
    };
  }
  const matchers = compile(condition);
  if (field === 'filename') return { ok: matchers.some((m) => m(null, ctx)) };
  for (const src of ctx.sources) {
    if (matchers.some((m) => m(src, ctx))) return { ok: true, source: src };
  }
  return { ok: false };
}

// ---------------------------------------------------------------------------
// Coverage (used to spot rules that can never fire)

function hostCovers(a, b) {
  return hostRegex(a).test(normalizeHost(b));
}

function altCovers(aField, a, bField, b) {
  if (aField === 'site' && bField === 'site') return hostCovers(a, b);
  if (aField === 'site' && bField === 'url') return hostCovers(a, splitUrlPattern(b).host);
  if (aField === 'url' && (bField === 'url' || bField === 'site')) {
    const pa = splitUrlPattern(a);
    const pb = bField === 'url' ? splitUrlPattern(b) : { host: b, path: '' };
    if (!hostCovers(pa.host, pb.host)) return false;
    if (pa.path === '' || pa.path === '/*') return true;
    return pb.path !== '' && pathRegex(pa.path).test(pb.path);
  }
  if (aField === 'filename' && bField === 'filename') {
    return new RegExp(`^${globSource(a, { questionMark: true })}$`, 'i').test(b);
  }
  if (aField === 'filename' && bField === 'filetype') {
    const type = getFileType(b);
    const glob = new RegExp(`^${globSource(a, { questionMark: true })}$`, 'i');
    return Boolean(type) && type.extensions.every((ext) => glob.test(`*.${ext}`));
  }
  if (aField === 'filetype' && bField === 'filetype') return a === b;
  if (aField === 'filetype' && bField === 'filename') {
    const ext = /^\*\.([a-z0-9]+)$/i.exec(b)?.[1]?.toLowerCase();
    return Boolean(ext) && getFileType(a)?.extensions.includes(ext);
  }
  return false;
}

/** True when every download matching `b` is guaranteed to match `a`. */
export function conditionCovers(a, b) {
  const altsA = splitAlternatives(a.pattern);
  const altsB = splitAlternatives(b.pattern);
  return altsB.every((altB) => altsA.some((altA) => altCovers(a.field, altA, b.field, altB)));
}

/** A rough "how narrow is this condition" score. Higher means more specific. */
export function conditionSpecificity({ field, pattern }) {
  const weight = { url: 3000, site: 2000, filename: 1000, filetype: 500 }[field] ?? 0;
  const alts = splitAlternatives(pattern);
  if (field === 'filetype') return weight - (alts.length - 1);
  const literal = Math.min(...alts.map((alt) => alt.replace(/[*?]/g, '').length));
  return weight + literal * 10 - (alts.length - 1);
}

// ---------------------------------------------------------------------------
// Descriptions

function describeHost(alt) {
  const p = normalizeHost(stripScheme(alt).replace(/\/+$/, ''));
  if (p === '*' || p === '') return 'any website';
  if (p.startsWith('*.')) return `${p.slice(2)} and its subdomains`;
  return p;
}

/** One short sentence explaining what a condition matches. */
export function describeCondition(condition) {
  const { field, pattern } = normalizeCondition(condition);
  const alts = splitAlternatives(pattern);
  if (field === 'filetype') {
    const types = alts.map(getFileType);
    if (types.length === 0 || !types.every(Boolean)) return 'Unknown file type';
    if (types.length > 1) return types.map((t) => t.label.toLowerCase()).join(' or ');
    const [type] = types;
    const sample = type.extensions.slice(0, 4).map((ext) => `.${ext}`);
    return `${type.label} (${sample.join(', ')}${type.extensions.length > 4 ? ', …' : ''})`;
  }
  if (alts.length === 0) return '';
  const parts = alts.map((alt) => {
    if (field === 'site') return describeHost(alt);
    if (field === 'url') {
      const { host, path } = splitUrlPattern(alt);
      if (path === '' || path === '/*') return `anything on ${describeHost(host)}`;
      const section = path.replace(/\/\*$/, '');
      return section.includes('*')
        ? `${describeHost(host)} paths like ${path}`
        : `${describeHost(host)} under ${section}`;
    }
    if (alt === '*') return 'any file';
    const ext = /^\*\.([^*?]+)$/.exec(alt);
    if (ext) return `.${ext[1]} files`;
    if (/^[^*?]+\*$/.test(alt)) return `names starting with “${alt.slice(0, -1)}”`;
    if (/^[^*?]+$/.test(alt)) return `exactly “${alt}”`;
    return `names like “${alt}”`;
  });
  return parts.join(' or ');
}
