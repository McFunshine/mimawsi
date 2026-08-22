# Acceptance Criteria: mimawsi.com v1

Pipeline position: proposal → spec → **criteria** → rules → review → plan

Source: [spec.md](./spec.md) — "Behaviors to verify" (B-1…B-34) is the contract.

**Bounded values used below.** File size cap: 25 MiB = 26,214,400 bytes. Daily submission
limit: 5 accepted submissions per account per rolling 24 hours.

**Resolved while writing.** Usernames are display-only and are not identifiers — the spec
settles that there are no maker profile pages and that account identity is the Google
account. Duplicate usernames are therefore permitted and no collision path is required.
*(Source: spec.md, Out of scope, "maker profile pages"; B-12.)*

---

## Functional

### Discovery

### AC-1: Catalogue is public
**Covers:** B-1

When a visitor requests the catalogue without an authenticated session, the system shall return the collection of approved tools.

### AC-2: Unapproved tools are not disclosed
**Covers:** B-1

If a tool is in any state other than approved, then the system shall omit it from the catalogue and shall not disclose its file contents, title or description to an unauthenticated requester.

### AC-3: Search returns matches
**Covers:** B-2

When a visitor submits a search query, the system shall return the approved tools whose title, description or tags match that query.

### AC-4: Search returns nothing on no match
**Covers:** B-2

If a search query matches no approved tool, then the system shall return an empty result set and shall not return unmatched tools.

### AC-5: Tools execute in isolation
**Covers:** B-3

When a visitor chooses to try an approved tool, the system shall execute that tool in a context that denies it access to the host page's origin, storage and document.

### AC-6: Executing tools cannot reach the network
**Covers:** B-3

While an approved tool is executing within the site, the system shall deny every outbound network request originating from that tool.

### AC-7: Downloads are byte-exact
**Covers:** B-4

When a visitor downloads an approved tool, the system shall serve the exact byte sequence published as that tool's current approved version.

### AC-8: Screenshot shown when present
**Covers:** B-5

Where a screenshot exists for an approved tool, the system shall display that screenshot with the tool in the catalogue.

### AC-9: Missing screenshot does not suppress the tool
**Covers:** B-5

If no screenshot exists for an approved tool, then the system shall present that tool without an image and shall not exclude it from the catalogue.

### Sharing

### AC-10: Dropped file runs without transmission
**Covers:** B-6

When a maker supplies a file to the submission interface, the system shall execute that file locally in the maker's browser and shall not transmit its contents.

### AC-11: Structural failures reported before transmission
**Covers:** B-7

If a supplied file fails a structural check, then the system shall report the failing check to the maker and shall not transmit the file.

### AC-12: File below the size cap is accepted
**Covers:** B-8

When a maker supplies a file of 26,214,399 bytes or fewer, the system shall accept it for submission.

### AC-13: File exactly at the size cap is accepted
**Covers:** B-8

When a maker supplies a file of exactly 26,214,400 bytes, the system shall accept it for submission.

### AC-14: File above the size cap is rejected
**Covers:** B-8

If a maker supplies a file of 26,214,401 bytes or more, then the system shall reject it, report the size limit to the maker, and shall not transmit the file.

### AC-15: Non-HTML input is rejected
**Covers:** B-9

If a maker supplies input that is not a single HTML file, then the system shall reject it, report the required format, and shall not transmit it.

### AC-16: Description is drafted from source
**Covers:** B-10

When a maker requests a drafted description, the system shall produce a description derived from the supplied file's source and present it as editable.

### AC-17: Draft failure does not block submission
**Covers:** B-10

If description drafting does not produce a result, then the system shall allow the maker to supply a description manually and shall not prevent submission.

### AC-18: Submission prompts authentication
**Covers:** B-11

When an unauthenticated maker submits, the system shall prompt for authentication.

### AC-19: No transmission without authentication
**Covers:** B-11, B-13

If a maker submits without completing authentication, then the system shall not transmit the file to storage and shall not create a submission record.

### AC-20: First authentication creates an account
**Covers:** B-12

When a maker authenticates for the first time, the system shall create an account for them and record a username.

### AC-21: Username is captured once
**Covers:** B-12

While an account already exists for a maker, when that maker authenticates, the system shall not prompt again for a username.

### AC-22: Authenticated submission transmits the file
**Covers:** B-13

When a maker completes authentication and submits, the system shall transmit the file to storage.

### AC-23: Duplicate files are rejected
**Covers:** B-14

If a submitted file's content hash matches that of an already-published tool, then the system shall reject the submission, identify the existing tool to the maker, and shall not create a new tool record.

### AC-24: Submission below the daily limit is accepted
**Covers:** B-15

When an account has 3 accepted submissions in the preceding 24 hours and submits again, the system shall accept the submission.

### AC-25: Submission at the daily limit is accepted
**Covers:** B-15

When an account has 4 accepted submissions in the preceding 24 hours and submits again, the system shall accept the submission.

### AC-26: Submission beyond the daily limit is rejected
**Covers:** B-15

If an account has 5 accepted submissions in the preceding 24 hours and submits again, then the system shall reject the submission, report the limit to the maker, and shall not create a submission record.

### AC-27: Accepted submission enters the queue as pending
**Covers:** B-16

When the system accepts a submission, the system shall record it in the review queue in the pending state.

### AC-28: Makers see their own submission status
**Covers:** B-17

When an authenticated maker requests their submissions, the system shall return the current state of each submission they own.

### AC-29: Makers cannot see others' submissions
**Covers:** B-17

If a maker requests a submission they do not own, then the system shall deny the request and shall not disclose that submission's state, file contents or metadata.

### Scanning

### AC-30: Every submission is scanned
**Covers:** B-18

When a submission enters the pending state, the system shall run the authoritative scan against its file.

### AC-31: Prohibited constructs cause rejection
**Covers:** B-19

If the authoritative scan detects a network primitive or an external subresource reference, then the system shall transition the submission to rejected and shall not publish it.

### AC-31a: Ambiguous constructs are flagged, not rejected
**Covers:** B-19a

If the authoritative scan detects dynamic code evaluation or an out-of-scope capability, then the system shall record a flag against the submission for reviewer attention and shall not transition it to rejected.

### AC-31b: Only network capability causes automatic rejection
**Covers:** Resolved ambiguities, "Auto-reject only for reaching the network"

If a submitted file contains no network primitive and no external subresource reference, then the system shall not automatically reject it.

### AC-31c: Local storage is permitted
**Covers:** Resolved ambiguities, "Tool capability envelope"

When a submitted file uses `localStorage` or `IndexedDB`, the system shall treat that use as permitted and shall not record a flag against the submission.

### AC-32: Scan findings are recorded
**Covers:** B-20

When the authoritative scan completes, the system shall record its findings against the submission and make them available to a reviewer.

### AC-33: Screenshot is captured during approval
**Covers:** B-21

When a submission is approved, the system shall capture a screenshot of the tool rendering.

### AC-34: Screenshot failure does not block publication
**Covers:** B-21

If screenshot capture does not produce an image, then the system shall publish the tool without a screenshot and shall not return the submission to the queue.

### Review

### AC-35: Reviewers see the tool and its findings
**Covers:** B-22

When an authorised reviewer opens a pending submission, the system shall present the tool executing alongside the recorded scan findings.

### AC-36: Review surface is closed to non-reviewers
**Covers:** B-22

If a requester without reviewer authorisation requests the review surface, then the system shall deny the request and shall not disclose any pending submission's file contents, metadata or scan findings.

### AC-37: Approval publishes the tool
**Covers:** B-23

While a submission is pending, when a reviewer approves it, the system shall transition it to published and make it available in the catalogue.

### AC-38: Published files carry an enforced content policy
**Covers:** B-24

When the system publishes a tool, the system shall embed a content security policy in the published file that denies all outbound network requests.

### AC-39: Approval notifies the maker
**Covers:** B-25

When a submission is approved, the system shall send the maker a notification of that outcome.

### AC-40: Rejection notifies the maker
**Covers:** B-25

When a submission is rejected, the system shall send the maker a notification of that outcome.

### AC-41: Rejections state the reason
**Covers:** B-26

When the system rejects a submission, the system shall include the specific check that failed.

### AC-42: Rejections state the remedy
**Covers:** B-26

When the system rejects a submission, the system shall include guidance describing how to make the file pass that check.

### AC-43: Rejected submissions can re-enter review
**Covers:** B-27

While a submission is rejected, when its maker supplies a revised file or revised metadata, the system shall transition that same submission to pending.

### After publication

### AC-44: Edits re-enter review
**Covers:** B-28

While a tool is published, when its maker supplies a changed file or changed metadata, the system shall place that change in the review queue in the pending state.

### AC-45: Published version serves during review of an edit
**Covers:** B-29

While an edit to a published tool is pending, the system shall continue to serve the currently approved version of that tool.

### AC-46: Tool address is stable across edits
**Covers:** B-30

When an edit to a published tool is approved, the system shall serve the new version at the same address as the previous version.

### AC-47: Makers can unpublish immediately
**Covers:** B-31

While a tool is published, when its maker requests unpublication, the system shall remove it from the catalogue without review.

### AC-48: Makers cannot unpublish others' tools
**Covers:** B-31

If a maker requests unpublication of a tool they do not own, then the system shall deny the request and shall not alter that tool's state.

### AC-49: Reports are accepted without an account
**Covers:** B-32

When a visitor without an authenticated session reports a published tool, the system shall record the report.

### AC-50: Reported tools remain available
**Covers:** B-33

If a published tool is reported, then the system shall continue to serve it and shall not alter its published state.

### AC-51: Reports reach the review queue
**Covers:** B-33

When the system records a report, the system shall place it in the queue for reviewer attention.

### AC-52: Reviewers can delist immediately
**Covers:** B-34

While a tool is published, when an authorised reviewer invokes delisting, the system shall remove it from the catalogue without further approval.

### AC-53: Delisting is closed to non-reviewers
**Covers:** B-34

If a requester without reviewer authorisation invokes delisting, then the system shall deny the request and shall not alter the tool's state.

### Data lifecycle

### AC-61: Account deletion removes personal data
**Covers:** B-35

When a maker deletes their account, the system shall delete the account record, the stored email address and the submission history, irrespective of any retention period still running against that data.

### AC-62: Account deletion does not remove published tools
**Covers:** B-36

If a maker deletes their account, then the system shall retain their published tools in the catalogue and shall not unpublish them.

### AC-63: Deleted makers are anonymously attributed
**Covers:** B-36

When a maker's account is deleted, the system shall cease displaying their username against their published tools.

### AC-64: Rejected submissions are retained within the retention period
**Covers:** B-37

While fewer than 90 days have elapsed since rejection and no erasure request has been made against it, the system shall retain the submission and its stored file.

### AC-65: Rejected submissions are purged after the retention boundary
**Covers:** B-37

When 90 days have elapsed since rejection, the system shall delete the submission's stored file no later than 92 days after rejection.

### AC-66: Rejected submissions do not survive the retention period
**Covers:** B-37

If more than 92 days have elapsed since rejection, then the system shall not retain the submission's stored file.

### AC-66a: Erasure overrides retention
**Covers:** B-35, B-37, B-38

When a maker deletes their account, the system shall delete their rejected submissions and unpublished tool files without waiting for the retention period to elapse.

### AC-67: Delisted tools are purged after the retention boundary
**Covers:** B-38

When 90 days have elapsed since a tool left the catalogue, the system shall delete its stored file no later than 92 days after it left.

### AC-68: Bans retain a hashed identifier
**Covers:** B-39

When an account is banned, the system shall retain a one-way hash of its email address together with the ban reason and date.

### AC-69: Ban records hold nothing further
**Covers:** B-39

If an account is banned and subsequently deleted, then the system shall not retain that account's email address, username, submission history or any value from which the email address can be recovered.

### AC-70: Banned addresses cannot re-register
**Covers:** B-40

If an applicant's email address matches a retained ban hash, then the system shall refuse account creation and shall not create an account record.

---

## Non-functional

### AC-54: Network denial holds for downloaded files
**Covers:** B-4, B-24; External dependencies, "CSP enforcement from `file://`"

When a published tool is opened directly from local storage in the current release of Chrome, Firefox or Safari, the system shall deny every outbound network request that tool attempts.

### AC-55: Downloaded tools can still save their output
**Covers:** B-4; Resolved ambiguities, "Read user-chosen files, process, generate a download"

When a published tool opened directly from local storage generates a file for saving, the system shall permit that file to be saved.

### AC-56: Catalogue is keyboard operable
**Covers:** B-1, B-2, B-3, B-4

The system shall make browsing, searching, trying and downloading a tool operable using a keyboard alone.

### AC-57: Catalogue meets contrast requirements
**Covers:** B-1, B-5

The system shall render catalogue text at a contrast ratio of at least 4.5:1 against its background.

### AC-58: Catalogue responds promptly
**Covers:** B-1

When a visitor requests the catalogue, the system shall return the first contentful render in under 1.5 seconds at the 95th percentile on a 4G connection.

### AC-59: Search responds promptly
**Covers:** B-2

When a visitor submits a search query, the system shall return results in under 200 milliseconds at the 95th percentile.

### AC-60: Isolation survives a hostile tool
**Covers:** B-3, B-6

If an executing tool attempts to read or modify the host page's document, storage or origin, then the system shall deny the attempt and shall continue serving the host page.

---

## Coverage exclusions

- **Load and scale testing** — no traffic expectations are defined in the spec, and the
  architecture is static-first with no stated concurrency target. Revisit once real traffic
  exists.
- **Availability and disaster recovery** — no uptime target or recovery objective is
  specified. Hosting is static and the tool files are the only irreplaceable asset.
- **Internationalisation** — not in the spec; no language other than English is contemplated
  for v1.
- **Accessibility of the tools themselves** — mimawsi does not control the internals of
  uploaded files and cannot assert conformance on a maker's behalf. Only the catalogue
  surface is covered, by AC-56 and AC-57.
- **Review turnaround time** — the spec explicitly declines to state a service level
  (Accepted Risk 1), so no criterion can assert one.
- **Legal sufficiency of the Terms and privacy policy** — the retention and deletion
  behaviour is specified (AC-61 to AC-70), but whether the published policy documents
  correctly describe it is a legal review, not a testable criterion.

---

## Traceability check

All 34 behaviours are covered:

| B | AC | B | AC | B | AC |
|---|---|---|---|---|---|
| B-1 | 1, 2, 56–58 | B-13 | 19, 22 | B-25 | 39, 40 |
| B-2 | 3, 4, 56, 59 | B-14 | 23 | B-26 | 41, 42 |
| B-3 | 5, 6, 56, 60 | B-15 | 24, 25, 26 | B-27 | 43 |
| B-4 | 7, 54, 55, 56 | B-16 | 27 | B-28 | 44 |
| B-5 | 8, 9, 57 | B-17 | 28, 29 | B-29 | 45 |
| B-6 | 10, 60 | B-18 | 30 | B-30 | 46 |
| B-7 | 11 | B-19 | 31 | B-31 | 47, 48 |
| B-8 | 12, 13, 14 | B-20 | 32 | B-32 | 49 |
| B-9 | 15 | B-21 | 33, 34 | B-33 | 50, 51 |
| B-10 | 16, 17 | B-22 | 35, 36 | B-34 | 52, 53 |
| B-11 | 18, 19 | B-23 | 37 | | |
| B-12 | 20, 21 | B-24 | 38, 54 | | |
| B-19a | 31a | B-37 | 64, 65, 66, 66a | B-39 | 68, 69 |
| B-35 | 61, 66a | B-38 | 67, 66a | B-40 | 70 |
| B-36 | 62, 63 | | | | |

AC-31b and AC-31c are policy criteria covering entries in *Resolved ambiguities* rather
than a B-N, as permitted by the traceability rule.