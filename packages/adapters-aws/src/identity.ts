import type { Maker } from '@mimawsi/domain';
import type { IdentityPort } from '@mimawsi/ports';

/**
 * Who is asking, while the answer can only be "the operator".
 *
 * Deliberately not an IdentityPort. A bearer token has no sign-in step to perform
 * and no session to end — signIn() could only return the same maker the token
 * already named, and signOut() could only lie, because the next request carrying
 * the token is authenticated again regardless. Implementing the full port would
 * mean writing two methods whose contract this mechanism cannot honour.
 *
 * SubmitDeps asks for Pick<IdentityPort, 'current'> and nothing more, so this
 * satisfies the upload path exactly. Google OAuth at task-3.4 does implement the
 * whole port, and replaces this without submit() changing.
 */
export type CurrentIdentity = Pick<IdentityPort, 'current'>;

export const OPERATOR: Maker = { id: { value: 'operator' }, displayName: 'Operator' };

/**
 * Compares in constant time. A plain `===` on a secret leaks its length and, in
 * principle, its prefix through timing; the token is short and the comparison is
 * cheap, so there is no reason to take the risk.
 */
function matches(presented: string, expected: string): boolean {
  if (presented.length !== expected.length) {
    return false;
  }
  let difference = 0;
  for (let i = 0; i < presented.length; i += 1) {
    difference |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * @param presented the token the caller sent, or null if they sent none
 * @param expected  the configured operator token
 */
export function operatorIdentity(
  presented: string | null,
  expected: string,
  who: Maker = OPERATOR,
): CurrentIdentity {
  return {
    async current(): Promise<Maker | null> {
      // An unset or empty expected token authenticates nobody. Treating a missing
      // configuration as "no check required" would turn a deployment mistake into
      // an open upload endpoint, which is the one outcome this must never have.
      if (expected === '' || presented === null) {
        return null;
      }
      return matches(presented, expected) ? who : null;
    },
  };
}
