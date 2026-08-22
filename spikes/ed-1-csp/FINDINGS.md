# ED-1 spike: is meta CSP enforced from `file://`?

**Date:** 2026-08-11 · **Status:** resolved for Chrome, Firefox and WebKit (WebKit closed 2026-08-22)
**Artifacts:** [probe.html](./probe.html) · [firefox-result.png](./firefox-result.png)

## The question

The product's central promise is that a downloaded tool cannot reach the network. The chosen
control is a Content-Security-Policy `<meta>` tag injected at publish time. No documentation
covers whether meta CSP is enforced for a file opened directly from disk, and the closest
precedent (Neocities) serves over HTTP where a *header* is available. Without an answer, the
safety model was unverified.

## Method

`probe.html` carries the candidate policy as the first element in `<head>` and attempts nine
things, recording every `securitypolicyviolation` event. The violation events are the
unambiguous signal — a merely *failed* request would be indistinguishable from having no
network at all.

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:
```

- **Chrome 152 headless** — `--dump-dom`, isolated profile
- **Firefox headless** — `--screenshot`, isolated profile
- Both loaded over `file://` (confirmed in output: `PROTOCOL: file:`)

## Result

**Meta CSP is enforced from `file://`.** Five violation events fired in both browsers,
identically.

| Probe | Chrome | Firefox | Verdict |
|---|---|---|---|
| `fetch` | connect-src violation | connect-src violation | **blocked** |
| `XMLHttpRequest` | connect-src violation | connect-src violation | **blocked** |
| `navigator.sendBeacon` | connect-src violation | connect-src violation | **blocked** |
| external `<img>` | img-src violation | img-src violation | **blocked** |
| `eval()` | script-src violation | script-src violation | **blocked** |
| inline `<script>` | ran | ran | allowed ✓ |
| `data:` image | loaded | loaded | allowed ✓ |
| `blob:` image | loaded | loaded | allowed ✓ |
| blob download link | created + clicked, no violation | same | allowed ✓ |

The candidate directive string is confirmed as correct and is now the verified value.

## Consequences for the design

1. **AC-54 and AC-55 both hold.** Network denied, generated downloads still work. RULE-16's
   decision not to build a bespoke analyser stands — CSP genuinely carries the risk.

2. **`eval` is blocked for free.** Omitting `'unsafe-eval'` means a published tool using
   `eval` or `Function()` simply cannot execute that code. This retrospectively justifies
   flagging rather than auto-rejecting dynamic evaluation (AC-31a): such a tool is broken,
   not dangerous, and the reviewer sees it broken.

3. **`sendBeacon`'s return value cannot be trusted.** Chrome returned `true` for a request
   CSP had blocked; Firefox correctly returned `false`. Any runtime detection (RULE-18) must
   observe requests or violation events, **never** an API's return value.

4. **`blob:` origin is `null`** under `file://`. Anything keyed on origin must not assume a
   meaningful one for downloaded tools.

## Outstanding

**Safari / WebKit is untested.** It has no headless CLI equivalent, and WebKit has
historically diverged on both CSP details and `file://` handling. Verify via Playwright's
WebKit build when the test harness exists (RULE-31), before launch rather than before
pipeline work — two independent engines agreeing makes a third divergence unlikely but not
impossible.

**Real download-to-disk was not verified.** The blob link was created and clicked with no CSP
violation, which answers the CSP question. Whether the file actually lands in the downloads
folder is a browser-behaviour question, not a policy one, and needs one manual check.

## WebKit — closed 2026-08-22

The remaining engine was answered by turning this spike into a standing regression suite:
`tests/specs/csp/downloaded-tool.spec.ts`, run through Playwright's WebKit build as
RULE-31 anticipated. **9/9 cases pass on WebKit**, matching Chromium and Firefox exactly:
`fetch`, `XMLHttpRequest`, `sendBeacon`, external `<img>` and `eval` are all refused from
`file://`, while inline script, `data:`/`blob:` images, blob downloads and `localStorage`
all work. Meta CSP is enforced from `file://` on all three engines.

Two findings the manual probe could not have produced:

1. **WebKit lies about `sendBeacon` too.** It returns `true` for a request CSP blocked —
   the same as Chromium, against Firefox's `false`. The return-value prohibition in
   RULE-18 now rests on two engines out of three, not one.

2. **Chromium reports CSP-blocked XHR and `<img>` requests to Playwright's `request`
   event** before the policy check runs, so a request event proves intent, not egress.
   The suite's oracle watches *responses* instead. No `requestfailed` event fires for a
   blocked `fetch` in any engine, so absence of a failure event is not evidence of a block
   either.

Run it with `cd tests && npm run test:csp`.
