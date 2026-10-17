import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  registrableDomain,
  resolveDestination,
  sanitizeSegment,
  validateDestination,
} from '../extension/lib/destination.js';
import { createContext } from '../extension/lib/rules.js';

describe('validateDestination', () => {
  test('cleans up harmless input', () => {
    assert.deepEqual(validateDestination(' Development/ GitHub '), {
      value: 'Development/GitHub',
      error: null,
      notice: null,
    });
    assert.equal(validateDestination('a\\b//c/').value, 'a/b/c');
    assert.equal(validateDestination('').value, '');
    assert.equal(validateDestination('').error, null);
  });

  test('drops a leading Downloads/ with a notice', () => {
    for (const input of ['Downloads/Example', '~/Downloads/Example', 'downloads/Example']) {
      const result = validateDestination(input);
      assert.equal(result.value, 'Example', input);
      assert.equal(result.error, null);
      assert.match(result.notice, /already inside it/);
    }
    assert.equal(validateDestination('Downloads').value, '');
    assert.equal(validateDestination('DownloadsArchive/x').value, 'DownloadsArchive/x');
  });

  test('rejects paths Chrome would ignore or that break on some OS', () => {
    const errors = {
      '/Users/me/Projects': /download folder/,
      '~/Projects': /download folder/,
      'C:/Temp': /download folder/,
      'a/../b': /“\.\.”/,
      'a/./b': /“\.”/,
      'what?': /“\?”/,
      'a:b': /“:”/,
      'trailing./x': /dot or space/,
      'CON/files': /reserved/,
      'a/nul.txt': /reserved/,
      '{nope}/x': /Unknown variable \{nope\}/,
      'open{year': /Unmatched/,
      [`${'x'.repeat(121)}`]: /too long/,
    };
    for (const [input, pattern] of Object.entries(errors)) {
      assert.match(validateDestination(input).error ?? '', pattern, input);
    }
  });

  test('accepts known variables', () => {
    assert.equal(validateDestination('Sites/{domain}/{year}-{month}').error, null);
  });
});

describe('resolveDestination', () => {
  const ctx = createContext({
    url: 'https://docs.github.com/files/guide.pdf',
    date: new Date(2026, 2, 7),
  });

  test('expands variables', () => {
    assert.equal(
      resolveDestination('{domain}/{host}/{category}/{ext}/{year}/{month}/{day}/{date}', ctx),
      'github.com/docs.github.com/Documents/pdf/2026/03/07/2026-03-07',
    );
  });

  test('handles downloads without a site or extension', () => {
    const empty = createContext({ url: 'data:text/plain,hi', filename: 'README' });
    assert.equal(
      resolveDestination('{domain}/{ext}/{category}', empty),
      'Other sites/no-extension/Other',
    );
  });

  test('plain folders pass through', () => {
    assert.equal(resolveDestination('Development/GitHub', ctx), 'Development/GitHub');
    assert.equal(resolveDestination('', ctx), '');
  });
});

describe('helpers', () => {
  test('registrableDomain', () => {
    assert.equal(registrableDomain('docs.github.com'), 'github.com');
    assert.equal(registrableDomain('github.com'), 'github.com');
    assert.equal(registrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
    assert.equal(registrableDomain(''), '');
  });

  test('sanitizeSegment', () => {
    assert.equal(sanitizeSegment('a/b:c?'), 'a_b_c_');
    assert.equal(sanitizeSegment('..hidden. '), 'hidden');
  });
});
