import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  conditionCovers,
  describeCondition,
  detectField,
  normalizeCondition,
  testCondition,
  validateCondition,
} from '../extension/lib/patterns.js';
import { createContext } from '../extension/lib/rules.js';

const ctx = (url, filename = '', extra = {}) => createContext({ url, filename, ...extra });
const matches = (field, pattern, context) => testCondition({ field, pattern }, context).ok;

describe('detectField', () => {
  const cases = [
    ['*.github.com', 'site'],
    ['github.com', 'site'],
    ['drive.google.com', 'site'],
    ['*.co.uk', 'site'],
    ['github.com/org/*', 'url'],
    ['https://example.com/reports', 'url'],
    ['flow.google.com/*', 'url'],
    ['*.pdf', 'filename'],
    ['invoice-*', 'filename'],
    ['report.pdf', 'filename'],
    ['*.tar.gz', 'filename'],
    ['*.pdf, *.docx', 'filename'],
    ['*', 'filename'],
    ['My File (1).txt', 'filename'],
    ['images', 'filetype'],
    ['Installers & apps', 'filetype'],
    ['documents, spreadsheets', 'filetype'],
    ['archive.zip', 'filename'],
    ['brew.sh', 'site'], // .sh is more often a site; force with file:
  ];
  for (const [input, field] of cases) {
    test(`${input} → ${field}`, () => assert.equal(detectField(input).field, field));
  }

  test('explicit prefixes win and are stripped', () => {
    assert.deepEqual(detectField('file:install.sh'), { field: 'filename', pattern: 'install.sh' });
    assert.deepEqual(detectField('site: example.com'), { field: 'site', pattern: 'example.com' });
    assert.deepEqual(detectField('type:Images'), { field: 'filetype', pattern: 'images' });
  });

  test('a scheme is not mistaken for a prefix', () => {
    assert.equal(detectField('https://github.com').field, 'url');
  });
});

describe('site conditions', () => {
  test('exact host matches itself and www', () => {
    assert.ok(matches('site', 'example.com', ctx('https://example.com/a.pdf')));
    assert.ok(matches('site', 'example.com', ctx('https://www.example.com/a.pdf')));
    assert.ok(!matches('site', 'example.com', ctx('https://cdn.example.com/a.pdf')));
    assert.ok(!matches('site', 'example.com', ctx('https://notexample.com/a.pdf')));
  });

  test('*.host matches the bare host and every subdomain', () => {
    for (const url of [
      'https://github.com/x',
      'https://api.github.com/x',
      'https://a.b.github.com/x',
    ]) {
      assert.ok(matches('site', '*.github.com', ctx(url)), url);
    }
    assert.ok(!matches('site', '*.github.com', ctx('https://github.community/x')));
    assert.ok(!matches('site', '*.github.com', ctx('https://fakegithub.com/x')));
  });

  test('wildcards inside labels', () => {
    assert.ok(
      matches(
        'site',
        'doc-*.googleusercontent.com',
        ctx('https://doc-0s-9c.googleusercontent.com/f'),
      ),
    );
  });

  test('matches the referrer page as well as the download URL', () => {
    const c = ctx('https://drive.usercontent.google.com/download?id=1', 'a.pdf', {
      referrer: 'https://drive.google.com/drive/folders/abc',
    });
    const result = testCondition({ field: 'site', pattern: 'drive.google.com' }, c);
    assert.ok(result.ok);
    assert.equal(result.source.role, 'page');
  });

  test('matches the final URL after redirects', () => {
    const c = ctx('https://bit.ly/x', 'a.zip', { finalUrl: 'https://downloads.example.org/a.zip' });
    assert.ok(matches('site', '*.example.org', c));
  });

  test('blob: URLs use their origin', () => {
    assert.ok(matches('site', 'example.com', ctx('blob:https://example.com/7f0c-11')));
  });

  test('alternatives, case and ports', () => {
    assert.ok(matches('site', 'a.com, B.com', ctx('https://b.com:8443/x')));
  });

  test('data: URLs never match a site', () => {
    assert.ok(!matches('site', '*', ctx('data:text/plain,hello', 'hello.txt')));
  });
});

describe('url conditions', () => {
  test('path prefix with /*', () => {
    assert.ok(matches('url', 'github.com/org/*', ctx('https://github.com/org/repo/archive.zip')));
    assert.ok(!matches('url', 'github.com/org/*', ctx('https://github.com/other/repo.zip')));
    assert.ok(!matches('url', 'github.com/org/*', ctx('https://github.com/organization/x')));
  });

  test('path without wildcard means that section', () => {
    const p = 'example.com/reports';
    assert.ok(matches('url', p, ctx('https://example.com/reports')));
    assert.ok(matches('url', p, ctx('https://example.com/reports/q1.pdf?dl=1')));
    assert.ok(matches('url', 'example.com/reports/', ctx('https://example.com/reports/q1.pdf')));
    assert.ok(!matches('url', p, ctx('https://example.com/reportsarchive/q1.pdf')));
  });

  test('scheme is optional and ignored', () => {
    assert.ok(matches('url', 'https://example.com/a/*', ctx('http://example.com/a/b')));
    assert.ok(matches('url', '*://example.com/a/*', ctx('https://example.com/a/b')));
  });

  test('wildcard hosts and wildcards inside paths', () => {
    assert.ok(
      matches(
        'url',
        '*.google.com/*/export*',
        ctx('https://docs.google.com/d/123/export?format=pdf'),
      ),
    );
  });

  test('query strings are only considered when the pattern has one', () => {
    assert.ok(
      matches('url', 'example.com/get?type=pdf*', ctx('https://example.com/get?type=pdf&x=1')),
    );
    assert.ok(
      !matches('url', 'example.com/get?type=pdf*', ctx('https://example.com/get?type=zip')),
    );
  });

  test('percent-encoded paths are decoded', () => {
    assert.ok(
      matches('url', 'example.com/My Files/*', ctx('https://example.com/My%20Files/a.txt')),
    );
  });
});

describe('filename conditions', () => {
  test('extensions, prefixes and ? wildcards, case-insensitive', () => {
    const c = ctx('https://x.com/dl', 'Invoice-2026-03.PDF');
    assert.ok(matches('filename', '*.pdf', c));
    assert.ok(matches('filename', 'invoice-*', c));
    assert.ok(matches('filename', 'invoice-????-??.pdf', c));
    assert.ok(!matches('filename', '*.pdfx', c));
    assert.ok(matches('filename', '*.docx, *.pdf', c));
  });

  test('uses the basename of the path Chrome proposes', () => {
    assert.ok(matches('filename', 'a.zip', ctx('https://x.com/dl', '/Users/me/Downloads/a.zip')));
    assert.ok(
      matches('filename', 'a.zip', ctx('https://x.com/dl', 'C:\\Users\\me\\Downloads\\a.zip')),
    );
  });

  test('falls back to the URL when Chrome gives no name', () => {
    assert.ok(matches('filename', '*.dmg', ctx('https://x.com/files/App%20Setup.dmg')));
  });
});

describe('filetype conditions', () => {
  test('by extension', () => {
    assert.ok(matches('filetype', 'images', ctx('', 'photo.HEIC')));
    assert.ok(matches('filetype', 'archives', ctx('', 'src.tar.gz')));
    assert.ok(!matches('filetype', 'images', ctx('', 'notes.pdf')));
    assert.ok(matches('filetype', 'images, documents', ctx('', 'notes.pdf')));
  });

  test('by MIME when the extension is missing or unknown', () => {
    assert.ok(matches('filetype', 'images', ctx('', 'download', { mime: 'image/png' })));
    assert.ok(matches('filetype', 'video', ctx('', 'clip.bin', { mime: 'video/mp4' })));
    // A known extension is not overridden by a misleading MIME type.
    assert.ok(!matches('filetype', 'images', ctx('', 'a.pdf', { mime: 'image/png' })));
  });
});

describe('validateCondition', () => {
  test('valid patterns', () => {
    for (const [field, pattern] of [
      ['site', '*.github.com'],
      ['site', 'https://github.com/'],
      ['site', 'localhost'],
      ['url', 'github.com/org/*'],
      ['filename', 'My File (1).txt'],
      ['filetype', 'documents'],
    ]) {
      assert.equal(validateCondition({ field, pattern }), null, `${field}: ${pattern}`);
    }
  });

  test('helpful errors', () => {
    assert.match(validateCondition({ field: 'site', pattern: '' }), /Enter a pattern/);
    assert.match(validateCondition({ field: 'site', pattern: 'github.com/org' }), /Switch to URL/);
    assert.match(validateCondition({ field: 'site', pattern: 'github' }), /needs a domain/);
    assert.match(validateCondition({ field: 'site', pattern: 'git hub.com' }), /spaces/);
    assert.match(validateCondition({ field: 'filename', pattern: 'a/b.pdf' }), /slashes/);
    assert.match(validateCondition({ field: 'filetype', pattern: 'nope' }), /file type/);
    assert.match(validateCondition({ field: 'bogus', pattern: 'x' }), /what to match/);
  });
});

describe('normalizeCondition', () => {
  test('cleans site patterns', () => {
    assert.deepEqual(
      normalizeCondition({ field: 'site', pattern: ' HTTPS://GitHub.com/ ,a.com' }),
      {
        field: 'site',
        pattern: 'github.com, a.com',
      },
    );
  });
});

describe('conditionCovers', () => {
  const cov = (a, b) => conditionCovers(detectField(a), detectField(b));
  test('broader patterns cover narrower ones', () => {
    assert.ok(cov('*.github.com', 'api.github.com'));
    assert.ok(cov('*.github.com', 'github.com/org/*'));
    assert.ok(cov('github.com', 'github.com/org/*'));
    assert.ok(cov('github.com/*', 'github.com/org/*'));
    assert.ok(cov('*', 'invoice-*.pdf'));
    assert.ok(cov('*.pdf', 'invoice-*.pdf'));
    assert.ok(cov('documents', '*.pdf'));
    assert.ok(cov('*', 'images'));
    assert.ok(cov('documents, images', 'images'));
    assert.ok(!cov('images', 'documents, images'));
  });

  test('narrower or unrelated patterns do not', () => {
    assert.ok(!cov('github.com/org/*', '*.github.com'));
    assert.ok(!cov('api.github.com', '*.github.com'));
    assert.ok(!cov('*.pdf', 'documents'));
    assert.ok(!cov('*.github.com', '*.pdf'));
    assert.ok(!cov('*.pdf', '*.pdf, *.zip'));
    assert.ok(cov('*.pdf, *.zip', '*.zip'));
  });
});

describe('describeCondition', () => {
  test('reads naturally', () => {
    assert.equal(
      describeCondition({ field: 'site', pattern: '*.github.com' }),
      'github.com and its subdomains',
    );
    assert.equal(
      describeCondition({ field: 'url', pattern: 'github.com/org/*' }),
      'github.com under /org',
    );
    assert.equal(describeCondition({ field: 'filename', pattern: '*.pdf' }), '.pdf files');
    assert.equal(
      describeCondition({ field: 'filename', pattern: 'invoice-*' }),
      'names starting with “invoice-”',
    );
    assert.match(
      describeCondition({ field: 'filetype', pattern: 'documents' }),
      /^Documents \(\.pdf/,
    );
  });
});
