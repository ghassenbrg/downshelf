/**
 * Destinations are folder paths relative to Chrome's download location,
 * e.g. `Development/GitHub` or `Sites/{domain}/{year}`. Chrome ignores
 * absolute paths and `..`, so we reject them up front with a clear message
 * instead of letting downloads silently land somewhere unexpected.
 */
import { categorize, extensionOf } from './filetypes.js';

export const VARIABLES = {
  domain: { label: 'Domain', example: 'github.com', help: 'Site without subdomains' },
  host: { label: 'Host', example: 'docs.github.com', help: 'Full site name' },
  category: { label: 'File type', example: 'Documents', help: 'e.g. Documents, Images' },
  ext: { label: 'Extension', example: 'pdf', help: 'File extension' },
  year: { label: 'Year', example: '2026', help: 'Four-digit year' },
  month: { label: 'Month', example: '10', help: 'Two-digit month' },
  day: { label: 'Day', example: '17', help: 'Two-digit day' },
  date: { label: 'Date', example: '2026-10-17', help: 'YYYY-MM-DD' },
};

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we reject
const ILLEGAL_CHARS = /[<>:"|?*\u0000-\u001f]/;
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go']);

/**
 * Validates and normalises a destination template.
 * Returns `{ value, error, notice }`. `value` is the cleaned path ('' means
 * the top of the download folder).
 */
export function validateDestination(input) {
  let value = String(input ?? '')
    .trim()
    .replace(/\\/g, '/');
  let notice = null;

  if (/^(~\/)?downloads(\/|$)/i.test(value)) {
    value = value.replace(/^(~\/)?downloads\/?/i, '');
    notice = value
      ? 'No need to type “Downloads/” — every folder is already inside it.'
      : 'Matching files stay at the top of your Downloads folder.';
  } else if (/^(\/|~|[a-z]:\/)/i.test(value)) {
    return {
      value,
      error:
        'Chrome only lets extensions save inside your download folder. Use a folder path like “Documents/PDF”.',
      notice,
    };
  }

  value = value
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');

  const template = /\{([^{}]*)\}/g;
  for (const [, name] of value.matchAll(template)) {
    if (!VARIABLES[name]) return { value, error: `Unknown variable {${name}}.`, notice };
  }
  const withoutVars = value.replace(template, 'x');
  if (/[{}]/.test(withoutVars)) return { value, error: 'Unmatched { or } in folder name.', notice };

  for (const segment of withoutVars.split('/').filter(Boolean)) {
    if (segment === '.' || segment === '..') {
      return { value, error: 'Folder names can’t be “.” or “..”.', notice };
    }
    const bad = ILLEGAL_CHARS.exec(segment);
    if (bad) {
      const shown = bad[0].charCodeAt(0) < 32 ? 'control characters' : `“${bad[0]}”`;
      return { value, error: `Folder names can’t contain ${shown}.`, notice };
    }
    if (/[. ]$/.test(segment)) {
      return { value, error: 'Folder names can’t end with a dot or space.', notice };
    }
    if (RESERVED_NAMES.test(segment)) {
      return { value, error: `“${segment}” is a reserved name on Windows.`, notice };
    }
    if (segment.length > 120) return { value, error: 'That folder name is too long.', notice };
  }
  return { value, error: null, notice };
}

/** Makes a value safe to use as (part of) a single folder name. */
export function sanitizeSegment(text) {
  return (
    String(text ?? '')
      // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what we strip
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 120)
  );
}

/** `docs.github.com` → `github.com`, `www.bbc.co.uk` → `bbc.co.uk`. */
export function registrableDomain(host) {
  const labels = String(host ?? '')
    .toLowerCase()
    .split('.')
    .filter(Boolean);
  if (labels.length <= 2 || /^\d+$/.test(labels.at(-1))) return labels.join('.');
  const keep = labels.at(-1).length === 2 && SECOND_LEVEL.has(labels.at(-2)) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

function pad(n) {
  return String(n).padStart(2, '0');
}

/**
 * Values for each template variable given a download context. `source` is
 * the URL that the rule matched on (falls back to the download URL).
 */
export function variableValues(ctx, source = ctx.sources?.[0]) {
  const date = ctx.date ?? new Date();
  const host = source?.host ?? '';
  const year = String(date.getFullYear());
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return {
    host: host || 'Other sites',
    domain: registrableDomain(host) || 'Other sites',
    category: categorize(ctx.filename, ctx.mime)?.label ?? 'Other',
    ext: extensionOf(ctx.filename) || 'no-extension',
    year,
    month,
    day,
    date: `${year}-${month}-${day}`,
  };
}

/** Expands `{variables}` and returns a clean relative folder path. */
export function resolveDestination(template, ctx, source) {
  const values = variableValues(ctx, source);
  return String(template ?? '')
    .split('/')
    .map((segment) =>
      sanitizeSegment(segment.replace(/\{([a-z]+)\}/g, (match, name) => values[name] ?? match)),
    )
    .filter(Boolean)
    .join('/');
}

export function joinPath(folder, filename) {
  return folder ? `${folder}/${filename}` : filename;
}
