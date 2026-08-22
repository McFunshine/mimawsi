/**
 * The policy under test comes from the product, never from a copy kept here.
 * RULE-45 exists because a second definition would let the injector and its
 * regression test drift apart silently — and this is the control the entire
 * promise rests on.
 */
export { TOOL_CSP } from '../../packages/injector/src/index.ts';

/** A host no tool may reach. Used as the exfiltration target in CSP specs. */
export const EXFIL_ORIGIN = 'https://exfil.invalid';
