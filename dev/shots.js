/**
 * Deterministic demo states for Chrome Web Store screenshots, used by the
 * preview server when a page is opened with ?shot=<name> (see
 * scripts/store-assets.mjs). Development only; never shipped.
 */
import { parseShorthand } from '../lib/rules.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const RULES = [
  ['Acme releases', 'github.com/acme/* & archives → Development/Acme/{year}'],
  ['GitHub', '*.github.com → Development/GitHub'],
  ['Google Flow', 'labs.google → AI/Flow'],
  ['Google Drive', 'drive.google.com → Drive'],
  ['Invoices & receipts', 'invoice-*, receipt-* → Finance/{year}'],
  ['Installers', 'installers → Installers'],
  ['Documents', 'documents, spreadsheets, presentations → Documents'],
  ['Images', 'images → Images'],
];

const STATS = {
  'Acme releases': [6, 2 * HOUR],
  GitHub: [31, 25 * MIN],
  'Google Flow': [48, 3 * MIN],
  'Google Drive': [12, 26 * HOUR],
  'Invoices & receipts': [9, 3 * DAY],
  Installers: [7, 6 * DAY],
  Documents: [64, 50 * MIN],
  Images: [23, 5 * HOUR],
  'Everything Google': [19, 40 * MIN],
};

const ACTIVITY = [
  ['flow-sunset-loop.mp4', 'AI/Flow', 2, 'labs.google', 3 * MIN],
  ['Q3-roadmap.pdf', 'Documents', 6, 'docs.google.com', 50 * MIN],
  ['app-2.4.0.zip', 'Development/Acme/2026', 0, 'github.com', 2 * HOUR],
  ['team-offsite.jpg', 'Images', 7, 'photos.google.com', 5 * HOUR],
  ['invoice-2026-10.pdf', 'Finance/2026', 4, 'billing.example.com', 3 * DAY],
  ['Figma-Setup.dmg', 'Installers', 5, 'figma.com', 6 * DAY],
];

function demoRules(lines = RULES) {
  return lines.map(([name, line], i) => ({ ...parseShorthand(line).rule, id: `r${i}`, name }));
}

async function waitFor(selector) {
  for (let i = 0; i < 100; i++) {
    const el = document.querySelector(selector);
    if (el) return el;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

function type(el, value) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const AFTER_LOAD = {
  // Rules list with the tester explaining a match.
  async rules() {
    type(
      await waitFor('#test-url'),
      'https://github.com/acme/app/releases/download/v2.4.0/app-2.4.0.zip',
    );
  },
  // The rule editor on a two-condition rule.
  async editor() {
    (await waitFor('.rule[data-id="r0"] .rule-body')).click();
  },
  // Conflict detection plus quick add.
  async order() {
    type(await waitFor('#quick-input'), '*.github.com & *.pdf → Papers/{year}');
    type(await waitFor('#test-url'), 'https://drive.usercontent.google.com/download?id=1x9');
    type(await waitFor('#test-name'), 'Budget 2027.xlsx');
  },
};

/** The storage contents for a scenario ('default' is the everyday preview). */
export function demoState(shot) {
  const now = Date.now();
  let lines = RULES;
  if (shot === 'order') {
    // A broad Google rule placed above Drive, so Drive's rule is flagged.
    lines = [
      RULES[0],
      ['Everything Google', '*.google.com → Google'],
      ...RULES.slice(3, 4),
      ...RULES.slice(1, 3),
      ...RULES.slice(4),
    ];
  }
  const rules = demoRules(lines);
  return {
    rules,
    settings: { enabled: true, conflictAction: 'uniquify', welcomeDismissed: shot !== 'default' },
    stats: Object.fromEntries(
      rules
        // In the conflict scenario Drive's rule is shadowed, so it has never fired.
        .filter((rule) => !(shot === 'order' && rule.name === 'Google Drive'))
        .map((rule) => [rule.id, { count: STATS[rule.name][0], last: now - STATS[rule.name][1] }]),
    ),
    activity: ACTIVITY.map(([filename, folder, rule, host, ago]) => ({
      at: now - ago,
      filename,
      folder,
      ruleId: rules.find((r) => r.name === RULES[rule][0])?.id,
      ruleTitle: RULES[rule][0],
      host,
    })),
  };
}

/** Scenario side effects, run once the mocked chrome.* API exists. */
export function runShot(shot) {
  if (shot === 'popup') {
    chrome.tabs.query = async () => [{ id: 1, url: 'https://labs.google/fx/tools/flow' }];
  }
  const after = AFTER_LOAD[shot];
  if (after) setTimeout(() => after().catch(console.error), 100);
}
