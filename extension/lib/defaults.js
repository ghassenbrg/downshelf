import { parseShorthand } from './rules.js';

/**
 * Starter rules for first-time users: sort by file type out of the box, plus
 * a disabled site rule that shows how site-based routing looks.
 */
const STARTERS = [
  ['GitHub downloads', '*.github.com → Development/GitHub', false],
  ['Installers', 'installers → Installers', true],
  ['Documents', 'documents, spreadsheets, presentations → Documents', true],
  ['Images', 'images → Images', true],
  ['Archives', 'archives → Archives', true],
];

export function starterRules() {
  return STARTERS.map(([name, line, enabled]) => ({
    ...parseShorthand(line).rule,
    name,
    enabled,
  }));
}

/** Ideas offered in the "new rule" dialog. */
export const RULE_TEMPLATES = [
  { label: 'Everything from a site', line: '*.example.com → Sites/{domain}' },
  { label: 'A section of a site', line: 'example.com/reports/* → Reports' },
  { label: 'Files by name', line: 'invoice-*, receipt-* → Finance/{year}' },
  { label: 'Files by type', line: 'video, audio → Media' },
  { label: 'PDFs from one site', line: '*.example.com & *.pdf → Papers' },
];

export const DEFAULT_SETTINGS = {
  enabled: true,
  conflictAction: 'uniquify',
  welcomeDismissed: false,
};
