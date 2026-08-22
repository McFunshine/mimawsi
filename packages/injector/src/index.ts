/**
 * Publish-time CSP injection — the control the whole product rests on.
 *
 * task-1.5. Parsing, not string replacement (RULE-45). The placeholder this
 * replaces trusted a regex to find `<head>`, which meant markup a browser reads
 * one way and the injector reads another shipped with no policy at all: given
 * `<!-- <head> --><script>…`, the regex matched the `<head>` *inside the comment*
 * and put the meta there, where a browser never sees it. A parser that disagrees
 * with browsers about malformed markup is the whole hazard, so this uses the same
 * spec-conformant parse a browser performs.
 */
import { parse, serialize } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];

/**
 * Confirmed enforced from `file://` in Chromium, Firefox and WebKit — see
 * spikes/ed-1-csp/FINDINGS.md and tests/specs/csp. Changing this string
 * invalidates every one of those results.
 */
export const TOOL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

export const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">`;

/** A file whose head could not be located is refused, never passed through. */
export class InjectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InjectionError';
  }
}

const children = (node: Node): Node[] =>
  'childNodes' in node && Array.isArray(node.childNodes) ? node.childNodes : [];

function findHead(node: Node): Element | null {
  for (const child of children(node)) {
    if (child.nodeName === 'head') {
      return child as Element;
    }
    const nested = findHead(child);
    if (nested) {
      return nested;
    }
  }
  return null;
}

const isCspMeta = (node: Node): boolean =>
  node.nodeName === 'meta' &&
  (node as Element).attrs.some(
    (attr) =>
      attr.name.toLowerCase() === 'http-equiv' &&
      attr.value.trim().toLowerCase() === 'content-security-policy',
  );

/** A policy the tool declared for itself must not survive publication. */
function stripDeclaredPolicies(node: Node): void {
  if (!('childNodes' in node) || !Array.isArray(node.childNodes)) {
    return;
  }
  node.childNodes = node.childNodes.filter((child) => !isCspMeta(child));
  for (const child of node.childNodes) {
    stripDeclaredPolicies(child);
  }
}

/**
 * Inserts the verified policy as the first child of head.
 *
 * First matters: a policy that arrives after a `<script>` in source order does
 * not govern it.
 */
export function injectCsp(html: string): string {
  const document = parse(html);

  // parse5 follows the HTML spec's tree construction, so a head exists even for
  // a fragment like `<div><p>oops` — the same head the browser would synthesise.
  const head = findHead(document);
  if (!head) {
    throw new InjectionError('could not locate <head>; refusing to publish unprotected');
  }

  stripDeclaredPolicies(document);

  const meta = {
    nodeName: 'meta',
    tagName: 'meta',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    attrs: [
      { name: 'http-equiv', value: 'Content-Security-Policy' },
      { name: 'content', value: TOOL_CSP },
    ],
    childNodes: [],
    parentNode: head,
  } as unknown as Element;

  head.childNodes.unshift(meta);

  const output = serialize(document);
  if (!output.includes(CSP_META)) {
    throw new InjectionError('policy did not survive serialisation; refusing to publish');
  }
  return output;
}
