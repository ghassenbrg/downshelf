import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createContext,
  createRule,
  exportRules,
  findShadowed,
  importRules,
  insertionIndex,
  parseShorthand,
  route,
  sortBySpecificity,
  toShorthand,
  validateRule,
} from '../extension/lib/rules.js';

const rule = (line, extra = {}) => {
  const { rule: r, error } = parseShorthand(line);
  assert.equal(error, null, `${line}: ${error}`);
  return { ...r, ...extra };
};

// The example from the project brief, ordered most-specific first.
const rules = [
  rule('github.com/org/* → Development/MyOrg'),
  rule('*.github.com → Development/GitHub'),
  rule('flow.google.com/* → AI/Flow'),
  rule('*.pdf → Documents/PDF'),
];

const at = (url, filename, extra) => route(rules, createContext({ url, filename, ...extra }));

describe('route', () => {
  test('first matching rule wins', () => {
    assert.equal(
      at('https://github.com/org/app/releases/v1.zip', 'v1.zip').path,
      'Development/MyOrg/v1.zip',
    );
    assert.equal(at('https://objects.github.com/x', 'a.pdf').path, 'Development/GitHub/a.pdf');
    assert.equal(at('https://flow.google.com/project/1', 'clip.mp4').path, 'AI/Flow/clip.mp4');
    assert.equal(at('https://example.com/paper', 'paper.pdf').path, 'Documents/PDF/paper.pdf');
  });

  test('unmatched downloads are left alone', () => {
    const result = at('https://example.com/a', 'a.zip');
    assert.equal(result.rule, null);
    assert.equal(result.path, 'a.zip');
  });

  test('disabled rules are skipped and reported', () => {
    const list = [rule('*.pdf → PDFs', { enabled: false }), rule('* → Everything')];
    const result = route(list, createContext({ url: 'https://x.com/a.pdf' }));
    assert.equal(result.path, 'Everything/a.pdf');
    assert.equal(result.evaluations[0].skipped, true);
  });

  test('invalid rules never match', () => {
    const broken = { ...rule('*.pdf → PDFs'), destination: '../escape' };
    const result = route([broken], createContext({ url: 'https://x.com/a.pdf' }));
    assert.equal(result.rule, null);
    assert.equal(result.evaluations[0].invalid, true);
  });

  test('all conditions of a rule must match', () => {
    const list = [rule('*.github.com & *.pdf → GitHub/PDF'), rule('*.github.com → GitHub')];
    assert.equal(
      route(list, createContext({ url: 'https://github.com/a.pdf' })).folder,
      'GitHub/PDF',
    );
    assert.equal(route(list, createContext({ url: 'https://github.com/a.zip' })).folder, 'GitHub');
  });

  test('variables use the source that matched', () => {
    const list = [rule('*.google.com → Google/{host}/{category}')];
    const result = route(
      list,
      createContext({
        url: 'https://drive.usercontent.google.com/download?id=1',
        referrer: 'https://drive.google.com/drive/my-drive',
        filename: 'notes.pdf',
      }),
    );
    assert.equal(result.path, 'Google/drive.usercontent.google.com/Documents/notes.pdf');
  });

  test('a rule with an empty destination keeps files at the top level', () => {
    const list = [rule('*.github.com & *.dmg → Downloads'), rule('*.dmg → Installers')];
    const result = route(list, createContext({ url: 'https://github.com/a.dmg' }));
    assert.equal(result.path, 'a.dmg');
    assert.equal(result.rule, list[0]);
  });
});

describe('ordering helpers', () => {
  test('findShadowed flags rules that can never match', () => {
    const generic = rule('*.github.com → GitHub');
    const specific = rule('github.com/org/* → MyOrg');
    const pdf = rule('*.pdf → PDF');
    const shadowed = findShadowed([generic, specific, pdf]);
    assert.equal(shadowed.get(specific.id), generic.id);
    assert.equal(shadowed.has(pdf.id), false);
    assert.equal(findShadowed([specific, generic, pdf]).size, 0);
  });

  test('a rule with more conditions is not shadowed by a broader one below it', () => {
    const list = [rule('*.github.com & *.pdf → A'), rule('*.github.com → B')];
    assert.equal(findShadowed(list).size, 0);
  });

  test('disabled rules do not shadow', () => {
    const list = [rule('* → All', { enabled: false }), rule('*.pdf → PDF')];
    assert.equal(findShadowed(list).size, 0);
  });

  test('insertionIndex places a new rule above broader or swallowing rules', () => {
    const list = [rule('*.github.com → GitHub'), rule('*.pdf → PDF'), rule('* → Other')];
    assert.equal(insertionIndex(list, rule('github.com/org/* → MyOrg')), 0);
    assert.equal(insertionIndex(list, rule('*.google.com → Google')), 1);
    assert.equal(insertionIndex(list, rule('invoice-*.pdf → Invoices')), 1);
    assert.equal(insertionIndex(list, rule('*.zip → Zips')), 2);
    assert.equal(insertionIndex(list.slice(0, 2), rule('*.zip → Zips')), 2);
    // A manually ordered list still never shadows the new rule.
    const manual = [rule('* → Everything'), rule('github.com/org/* → MyOrg')];
    assert.equal(insertionIndex(manual, rule('*.pdf → PDF')), 0);
  });

  test('sortBySpecificity puts narrow rules first', () => {
    const list = [
      rule('*.pdf → PDF'),
      rule('*.github.com → GitHub'),
      rule('github.com/org/* → MyOrg'),
      rule('drive.google.com → Drive'),
      rule('*.google.com → Google'),
      rule('*.github.com & *.pdf → GitHub/PDF'),
    ];
    const order = sortBySpecificity(list).map((r) => r.destination);
    assert.deepEqual(order, ['GitHub/PDF', 'MyOrg', 'Drive', 'GitHub', 'Google', 'PDF']);
    assert.equal(findShadowed(sortBySpecificity(list)).size, 0);
  });
});

describe('shorthand', () => {
  test('parses arrows, conditions and prefixes', () => {
    const { rule: r } = parseShorthand('site:*.github.com & file:*.zip, *.tar.gz -> Dev/Releases');
    assert.deepEqual(r.conditions, [
      { field: 'site', pattern: '*.github.com' },
      { field: 'filename', pattern: '*.zip, *.tar.gz' },
    ]);
    assert.equal(r.destination, 'Dev/Releases');
    assert.equal(parseShorthand('images => Pictures/{year}').rule.conditions[0].field, 'filetype');
  });

  test('reports errors', () => {
    assert.match(parseShorthand('*.pdf').error, /arrow/);
    assert.match(parseShorthand('*.pdf → /Users/me/PDF').error, /download folder/);
    assert.match(parseShorthand(' → PDF').error, /at least one condition/);
    assert.match(parseShorthand('*.pdf → ').error, /Add a folder/);
    assert.match(parseShorthand('github.com/* → {nope}').error, /Unknown variable/);
  });

  test('round-trips', () => {
    for (const line of [
      '*.github.com → Development/GitHub',
      'github.com/org/* & *.zip → Dev/{year}',
      'type:images → Pictures',
      'file:install.sh → Scripts',
      'documents → Downloads',
    ]) {
      const r = parseShorthand(line).rule;
      assert.deepEqual(parseShorthand(toShorthand(r)).rule.conditions, r.conditions, line);
    }
  });
});

describe('validateRule', () => {
  test('collects every problem', () => {
    const check = validateRule({
      conditions: [
        { field: 'site', pattern: '' },
        { field: 'filename', pattern: '*.pdf' },
      ],
      destination: 'a/../b',
    });
    assert.equal(check.valid, false);
    assert.match(check.conditions[0], /Enter a pattern/);
    assert.equal(check.conditions[1], null);
    assert.match(check.destination, /“\.\.”/);
  });
});

describe('import / export', () => {
  test('export then import keeps rules but issues new ids', () => {
    const data = JSON.parse(JSON.stringify(exportRules(rules)));
    assert.equal(data.format, 'downshelf-rules');
    const { rules: imported, errors } = importRules(data);
    assert.deepEqual(errors, []);
    assert.equal(imported.length, rules.length);
    assert.deepEqual(
      imported.map((r) => r.conditions),
      rules.map((r) => r.conditions),
    );
    assert.notEqual(imported[0].id, rules[0].id);
  });

  test('accepts JSON text, bare arrays and shorthand text', () => {
    assert.equal(importRules(JSON.stringify(exportRules(rules))).rules.length, 4);
    assert.equal(
      importRules([{ conditions: [{ field: 'filename', pattern: '*.pdf' }], destination: 'P' }])
        .rules.length,
      1,
    );
    const text = '# my rules\n*.pdf → PDF\n\n*.github.com → GitHub\nbroken line\n';
    const result = importRules(text);
    assert.equal(result.rules.length, 2);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /^Line 3/);
  });

  test('rejects junk with a clear message', () => {
    assert.match(importRules({ hello: 1 }).errors[0], /Downshelf backup/);
    const { rules: ok, errors } = importRules([
      { conditions: [{ field: 'filename', pattern: '*.pdf' }], destination: '/etc' },
      { conditions: [], destination: 'x' },
      null,
    ]);
    assert.equal(ok.length, 0);
    assert.equal(errors.length, 3);
  });

  test('createRule normalises input', () => {
    const r = createRule({
      conditions: [{ field: 'site', pattern: 'HTTPS://Example.com/' }],
      destination: 'Downloads/A//B/',
    });
    assert.deepEqual(r.conditions, [{ field: 'site', pattern: 'example.com' }]);
    assert.equal(r.destination, 'A/B');
    assert.equal(r.enabled, true);
  });
});

describe('starter rules', async () => {
  const { starterRules } = await import('../extension/lib/defaults.js');
  test('are valid, unshadowed and route common files', () => {
    const starters = starterRules();
    assert.ok(starters.every((r) => validateRule(r).valid));
    assert.equal(findShadowed(starters).size, 0);
    const where = (filename) =>
      route(starters, createContext({ url: 'https://x.com/f', filename })).folder;
    assert.equal(where('Setup.dmg'), 'Installers');
    assert.equal(where('budget.xlsx'), 'Documents');
    assert.equal(where('photo.jpg'), 'Images');
    assert.equal(where('song.mp3'), '');
  });
});
