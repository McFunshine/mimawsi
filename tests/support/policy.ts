/**
 * The verified CSP. Confirmed enforced from `file://` in Chrome 152 and Firefox
 * by the ED-1 spike (spikes/ed-1-csp/FINDINGS.md). Do not edit this string
 * without re-running specs/csp — it is the product's central safety control.
 */
export const TOOL_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:";

/** A host no tool may reach. Used as the exfiltration target in CSP specs. */
export const EXFIL_ORIGIN = 'https://exfil.invalid';
