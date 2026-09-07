# What a tool is rejected for, and how that is checked

Draft for argument, 2026-09-07. Nothing here is implemented. The point of writing
it down is to find out which of these are real and which only sound real.

## The principle

The front page makes a promise:

> A catalogue of small, single-file tools. Download one, double-click it, and it
> works — offline, forever, with nothing to install and nothing sent anywhere.

Most of the review is not a moral question. It is checking whether that sentence
is true of this file. Every clause is a testable claim, and a tool that breaks
one is rejected on the terms it was submitted under — no judgement required, and
nothing for the maker to argue with.

The rest — the small, uncomfortable part — is deciding what we will not host at
all. That needs a written line, because without one it becomes whatever the
approver felt like that afternoon.

## The dual-use rule

A tool is a tool. A text box can type anything, and a captioner can caption
something vile. If "could be used for" were the test, the catalogue would be
empty, because that test rejects the notepad.

**Judge the artefact, not the imagined user.** Two questions, and a rejection
needs a yes to one of them:

1. **Is it in the bytes?** An explicit image shipped as the default. A slur list
   baked into the source. A real person's data. A working credential.
2. **Is it the point?** Would a reasonable person, reading the title, the
   description and the interface, say *this is a tool for that*?

If both are no, it publishes, however unpleasant the thing you can imagine
someone doing with it. Written out:

| Submission | Verdict | Why |
|---|---|---|
| Text formatter | publish | Could type anything. So could a pen. |
| Image captioner, user supplies the image | publish | The objectionable input is the user's, and never leaves their machine |
| The same captioner, shipping an explicit image as its example | reject | In the bytes |
| A tool whose stated purpose is undressing photographs | reject | Is the point |
| Password generator | publish | Ordinary utility |
| "Card number generator" | reject | Is the point, and is a fraud instrument |
| Insult generator, playground grade | publish | Neither test trips |
| The same, with racial slurs in the word list | reject | In the bytes |

The rule's virtue is that it is checkable by someone else. Its cost is that it
lets through things that feel wrong and are not. That is the intended trade: the
alternative rejects the notepad.

## What the sandbox already prevents, measured

Worth establishing before writing checks, because a check for something already
impossible is theatre, and a check missing for something possible is worse.

Injected policy (`packages/injector/src/index.ts`):
`default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:`

Probed in a real browser, from `file://`, with every outbound request logged:

| Channel | Result |
|---|---|
| `fetch` | blocked |
| `XMLHttpRequest` | blocked |
| remote `<img src>` | blocked |
| `navigator.sendBeacon` | blocked |
| `WebSocket` | blocked |
| injected `<script src>` | blocked |
| `<link rel=prefetch>` | blocked |
| **form submission to a remote URL** | **escapes** |
| **`window.open(url)`** | **escapes** |
| **`location.href = url`** | **escapes** |
| **anchor navigation** | **escapes** |

The four that escape all work by *navigating* rather than fetching, and CSP has
no directive that stops navigation — `navigate-to` was specified and never
shipped in any browser.

**This matters more than it first looks, because the two ways to use a tool are
not equally protected.**

- **On the site**, the `Try` page frames the tool with
  `sandbox="allow-scripts allow-downloads"` (`packages/site/src/pages/run/[id].astro:39`).
  No `allow-forms`, no `allow-popups`, no `allow-top-navigation`. All four
  escapes are closed by the frame.
- **Downloaded and double-clicked** — the thing the front page actually tells
  people to do — only the meta policy applies, and all four are open. A tool can
  put everything you typed into a query string and open it.

Two consequences:

1. `form-action 'none'; base-uri 'none'` should be added to the injected policy.
   It costs nothing, closes the form channel in the downloaded copy, and closes
   a `<base>` redirect trick. Cheap, and it shrinks what review has to catch.
2. `window.open` and `location.href` cannot be closed by policy. **They are
   permanently a review question**, and check 4 below exists precisely because
   there is no technical control to replace it.

## The checks

Ten. Numbers 1–7 test the promise and are largely mechanical; 8–10 are
judgement. A tool is published only if none of them rejects it — but see the
note on the report afterwards, because *who* decides matters as much as what.

### 1. It runs at all
Open it headless from `file://`. A page that throws on load, renders blank, or
whose controls do nothing is rejected. Evidence: screenshot at rest, screenshot
after interaction, full console transcript. **Automatable.**

### 2. It does what it claims
The description says what it is for. If it does something else, or nothing, it
is rejected — this is the one a maker most often fails by accident, having
submitted the wrong file. Evidence: an exercise transcript of every control with
what changed. **Automatable to a transcript; a human reads it.**

### 3. It asks for the network
Any outbound request, even one the policy blocks. A blocked attempt is not
harmless: it is a statement of intent, and it means the tool does not work as
promised offline. Evidence: every attempted URL, with its source line.
**Automatable.**

### 4. It has a way to send data out that policy cannot close
Form submissions, `window.open`, `location.href`, anchors to remote URLs — and
above all any of those carrying user input. A link to the maker's homepage is
fine; a link with the user's text in the query string is the whole reason this
check exists. Evidence: static scan plus runtime navigation interception, with
the constructed URL shown. **Partly automatable, needs a human verdict.**

### 5. It is not self-contained
Any absolute URL to a script, stylesheet, font, or image. A CDN reference. An
import. Fails "offline" and "forever" together. Evidence: every external
reference found. **Automatable.**

### 6. It will not last
Anything that rots: a hardcoded date it stops working after, a licence check, an
API key, a trial, a reference to a service that can be turned off. "Forever" is
a promise the catalogue makes on the maker's behalf. Evidence: date and key
patterns, plus a human read. **Partly automatable.**

### 7. It needs something installed
Asks for an extension, a runtime, a font, a download, an account. Evidence: the
tool's own text. **Human, cheap.**

### 8. Sexual content
Rejected when it is in the bytes or is the point (see the rule above). Content
involving minors is not a rejection but a report, and is not a judgement call to
be weighed against anything.

### 9. Illegal, or an instrument for harm
Fraud instruments (card and IBAN generators, forged documents, counterfeit
receipts). Credential theft and malware. Circumvention tools. Doxxing, or any
tool containing a real person's data. Hate: slurs in the bytes, or demeaning a
protected group as the purpose. Dangerous instruction dressed as a tool —
synthesis routes, weapon construction, self-harm encouragement. Deception as the
point: fake receipts, fabricated screenshots of real services, impersonation of
a real organisation or person.

### 10. It is not a tool
A pamphlet with a button. An advertisement. A blank shell. A thing whose actual
purpose is to occupy a URL on this domain. Rejected for being off the point,
which is not a moral judgement and should not be dressed as one.

## The report

The format matters as much as the checks, so a note on it.

- **Evidence, not verdicts.** Every finding shows what was observed — the URL,
  the line, the screenshot — so the approver can disagree. A report that says
  "network access: fail" and nothing else is asking to be rubber-stamped.
- **It never says "safe".** It says what was checked and what was found. The
  difference is the whole honesty of the thing, and the first time it says
  "safe" about something that was not, nobody trusts any of it again.
- **It states what it could not check.** Explicitly, as a section, not by
  omission.
- **A check that cannot fail is deleted.** Every check needs a submission that
  would trip it, kept as a fixture. Otherwise the report grows green ticks that
  mean nothing, which is worse than not checking.
- **Automation is advisory. Approval stays a human act.** Checks 1–7 can hard-
  fail without a human, because they are factual. 8–10 must never auto-reject:
  they should surface a flag and a reason, and a person decides.

## Open questions

- **8–10 want a model.** A file and a description, read against a written
  standard, is what a language model is for. `grok_api_key` is already in
  `terraform.tfvars` and wired to nothing, and §7 plans a `GeneratorPort`. The
  same adapter serves both. It also means a model's opinion enters the approval
  path, which needs its own rules and a token ceiling.
- **Running untrusted HTML to review it** is itself the risk being reviewed.
  Offline, containerised, no credentials in the environment, nothing mounted.
- **Appeals.** The deny path already emails a reason. If a maker disagrees with
  a check-8 rejection, is there anything after that, or is the operator final?
- **Re-review on change.** A tool is immutable once published, so there is no
  drift — but if that ever changes, the report is stale from that moment.
- **The catalogue records what was checked?** The record repository proves what
  was published. It says nothing about what was examined, and a public standard
  with no public evidence of its application is only a claim.
