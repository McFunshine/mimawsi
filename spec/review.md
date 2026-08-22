# Spec Review: mimawsi.com v1

*Fifth pass, after introducing Python at the scan seam. Supersedes the fourth-pass PASS.*

## Summary

- **Feature:** mimawsi.com v1 — free catalogue of single-file, zero-install HTML tools
- **Verdict:** **PASS**
- **Counts:** 0 blockers, 0 majors, 4 minors
- **Action:** Proceed to execution. Both external dependencies are resolved; two items remain
  for before launch rather than before build.

## Discipline Check

Clean. Every `Covers:` reference in criteria.md and rules.md resolves, including the new
AC-66a and RULE-41 to RULE-43. B-35 to B-40 each appear in at least one AC. The 90-day
retention keeps its three-point boundary treatment (AC-64, AC-65, AC-66) now that the boundary
is expressed with a tolerance. criteria.md's traceability table and rules.md's Cross-Reference
were both extended for the additions. All criteria use an EARS template.

## Conflicts

None outstanding. The third pass's three findings are resolved, and one further conflict was
found and fixed during this pass:

- **BLOCKER-1 (erasure vs retention)** — spec.md now states precedence explicitly: an erasure
  request overrides the retention window immediately, with the ban hash as the single named
  exception, and retention is a maximum rather than a minimum. AC-61 carries the override,
  AC-64 is conditioned on no erasure request, and AC-66a states the rule directly. RULE-41
  forbids the tempting wrong implementation — shortening an object's retention clock instead
  of deleting it, which would leave data present for an unbounded period after the request.

- **MAJOR-1 (EU residency vs global CDN)** — RULE-37 is now scoped to *non-public* personal
  data: account records, emails, submission history, ban hashes. Content a maker chose to
  publish, including the username beside it, is meant for worldwide distribution, so RULE-2's
  CloudFront delivery is unaffected.

- **MAJOR-2 (unachievable timing precision)** — AC-65 and AC-66 now express deletion as "no
  later than 92 days", which S3 lifecycle and DynamoDB TTL can actually satisfy and a test can
  assert without flaking.

**Python at the scan seam (this pass).** RULE-44 confines Python to the scan workflow, RULE-45
keeps CSP injection in TypeScript with parse5, and RULE-15c mandates a spec-conforming parser.
Checked for conflicts and found none: the scan workflow shares no types with the browser, and
the injector stays co-located with the `file://` regression test that asserts its output. One
self-correction during the change — RULE-44 initially also claimed the retention jobs as a
Python home, but RULE-38 makes retention declarative via S3 lifecycle and DynamoDB TTL, so no
such job exists. The rule was narrowed and now records that explicitly.

- **Found and fixed in the fourth pass: stale Design Exclusion.** The exclusion claimed cache
  invalidation "falls out of content-addressed keys (RULE-12) and needs no separate design".
  That held while only tool files mattered, but RULE-42's rebuild-on-deletion exposed that
  catalogue *pages* are mutable at stable URLs and therefore not self-invalidating. Without
  explicit invalidation a deleted maker's username, or a delisted tool, would survive at edge
  locations for the life of the cached object. RULE-43 now requires invalidation, and the
  exclusion is withdrawn.

## Codebase Grounding

Clean. The repository still holds no code, so no rule conflicts with existing structure. The
data-lifecycle rules introduce no new dependency: RULE-38 is satisfied by S3 lifecycle
configuration and DynamoDB TTL, RULE-39 needs only a standard-library hash, and RULE-43 uses
CloudFront invalidation. Every service named in the design is available in an EU region as
RULE-37 requires. RULE-21 now rests on empirical verification rather than assumption.

The Python dependencies were checked against RULE-15c's requirement. `html5lib` implements the
WHATWG parsing algorithm and parses as browsers do, which is precisely the property that closes
the parser-differential gap; `lxml` is XML-driven and stricter, and `html.parser` does not even
insert the elements a browser would, so both are correctly excluded. semgrep is distributed on
PyPI, confirming the scan job carries a Python runtime regardless of whether any is written.
**Not yet verified locally:** the TypeScript dependencies were confirmed against the npm
registry, but no Python package was resolved in this environment — task-1.2 should confirm
`html5lib`, `semgrep` and `pytest` install together before phase 4 depends on them.

## EARS ↔ Test Strategy

Complete. The data-lifecycle criteria introduce no uncovered pattern: AC-62, AC-69 and AC-70
are negative criteria caught by RULE-34's assert-the-absence requirement; AC-64 to AC-66 form
a boundary triple caught by RULE-35; AC-61, AC-63 and AC-66a are event-driven and covered by
the Vitest and Playwright split in RULE-32. MAJOR-2's tolerance change removed the one case
where a criterion demanded precision no permitted mechanism could deliver.

## Risk Hotspots

1. **Script extraction is not provably complete** — still the sharpest technical risk.
   Enumerating execution routes is structurally the same losing game as enumerating malicious
   patterns, and a missed route fails silently.
   *Mitigation:* RULE-15a fails closed on unparseable input; CSP denies the network regardless;
   build the extractor against adversarial fixtures rather than well-formed files.

2. **Ban evasion is trivial** — AC-70 refuses re-registration on a matching email hash, but a
   fresh Google account defeats it in a minute. It is a speed bump and must not be described
   as more.
   *Mitigation:* treat file-hash dedupe (AC-23) and human review as the real controls; do not
   build further identity checks expecting them to hold.

3. **Safari is unverified** — Chrome and Firefox confirmed empirically; WebKit has diverged
   historically on both CSP and `file://`.
   *Mitigation:* verify via Playwright's WebKit build before launch. If Safari alone fails, the
   promise holds for most users but cannot be stated unconditionally.

4. **Deletion now spans four systems** — an erasure request must clear DynamoDB, delete S3
   objects, rebuild the catalogue and invalidate the CDN. Any one step failing leaves personal
   data visible while the system reports success.
   *Mitigation:* make erasure idempotent and re-runnable, and assert all four effects in one
   test rather than asserting the database write alone.

5. **Sandbox isolation (RULE-23)** — `allow-scripts` with `allow-same-origin` remains one
   attribute away, and the failure is silent and total.
   *Mitigation:* automated test asserting a hostile fixture cannot reach the host document.

## Minors (not blocking)

- **MINOR-1** — rules.md's Design section runs to roughly 235 words against its own 200-word
  limit, having grown with the results Lambda and the extraction step.
- **MINOR-2** — RULE-33 now sits after RULE-34 to RULE-43 in document order. All references
  resolve; only the reading order is untidy.
- **MINOR-3** — AC-63 says the system "shall cease displaying" a deleted maker's username
  without naming where. RULE-42 and RULE-43 together make the answer unambiguous in the rules,
  but the criterion itself remains silent on propagation.
- **MINOR-4** — `html5lib` is pure Python and correspondingly slow. Correctness is the right
  trade here and the scan is asynchronous, so latency is not user-facing, but a 25MB file may
  take a noticeable share of a workflow run. Measure at task-4.1 rather than assuming; if it
  becomes a problem the answer is a faster *conforming* parser, never a non-conforming one.

## External Dependencies

Both resolved.

- **ED-1** — meta CSP is confirmed enforced from `file://` in Chrome and Firefox, and blob
  downloads survive it. See [spikes/ed-1-csp/FINDINGS.md](../spikes/ed-1-csp/FINDINGS.md).
  Safari outstanding, to verify before launch.
- **ED-2** — retention and deletion settled, including the erasure-over-retention precedence.

**Before launch, not before build:** Safari verification, and legal review of the Terms and
privacy policy — the latter is a content deliverable, and the Terms must state that published
tools remain in the catalogue after account deletion.