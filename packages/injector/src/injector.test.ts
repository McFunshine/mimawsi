import { describe, expect, it } from 'vitest';
import { CSP_META, TOOL_CSP, injectCsp } from './index.ts';

const headOf = (html: string) => html.slice(html.indexOf('<head'), html.indexOf('</head>'));

describe('injectCsp', () => {
  it('puts the policy first in head, before any script', () => {
    const out = injectCsp('<html><head><script>fetch("https://evil.test")</script></head><body></body></html>');
    const head = headOf(out);
    expect(head.indexOf(CSP_META)).toBeGreaterThanOrEqual(0);
    expect(head.indexOf(CSP_META)).toBeLessThan(head.indexOf('<script'));
  });

  it('emits the verified directive string exactly, and never unsafe-eval', () => {
    const out = injectCsp('<html><head></head><body></body></html>');
    expect(out).toContain(CSP_META);
    expect(out).toContain(TOOL_CSP);
    expect(out).not.toContain('unsafe-eval');
  });

  it('is not diverted by a <head> inside a comment', () => {
    // The regex placeholder put the meta inside the comment, where a browser
    // never sees it, and the file shipped with no policy at all.
    const out = injectCsp('<!-- <head> --><script>fetch("https://evil.test")</script><head>');
    const beforeMeta = out.slice(0, out.indexOf(CSP_META));
    expect(out).toContain(CSP_META);
    expect(beforeMeta.lastIndexOf('<!--')).toBeLessThanOrEqual(beforeMeta.lastIndexOf('-->'));
    expect(out.indexOf(CSP_META)).toBeLessThan(out.indexOf('<script'));
  });

  it('strips a policy the tool declared for itself', () => {
    const out = injectCsp(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body></body></html>',
    );
    expect(out).not.toContain('default-src *');
    expect(out).toContain(CSP_META);
  });

  it('strips a declared policy wherever it sits, including the body', () => {
    const out = injectCsp(
      '<html><head></head><body><meta http-equiv="content-security-policy" content="default-src *"></body></html>',
    );
    expect(out).not.toContain('default-src *');
  });

  it('protects a bare fragment with no head or html of its own', () => {
    const out = injectCsp('<div><p>oops<script>fetch("https://evil.test")</script>');
    expect(headOf(out)).toContain(CSP_META);
  });

  it('preserves the doctype and the document it was given', () => {
    const out = injectCsp('<!doctype html><html lang="en"><head><title>t</title></head><body><h1>hi</h1></body></html>');
    expect(out.toLowerCase().startsWith('<!doctype html>')).toBe(true);
    expect(out).toContain('<title>t</title>');
    expect(out).toContain('<h1>hi</h1>');
    expect(out).toContain('lang="en"');
  });
});
