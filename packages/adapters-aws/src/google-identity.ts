import type { Maker } from '@mimawsi/domain';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import type { CurrentIdentity } from './identity.ts';

/**
 * Who is asking, according to Google.
 *
 * The browser signs in with Google and receives an ID token — a JWT Google
 * signed. It sends that as its bearer token, and this verifies it: the
 * signature against Google's published keys, the audience against our own client
 * id, the issuer, and the expiry. Nothing is trusted because it arrived; a JWT is
 * only meaningful once verified, and an unverified one is just a string the
 * caller chose.
 *
 * Checking the audience is the part that is easy to omit and must not be. Google
 * signs tokens for every application that uses it, so a token minted for some
 * other site would verify perfectly against Google's keys. Without the audience
 * check, anyone with a Google login anywhere could submit here.
 *
 * No client secret is involved. The browser does the sign-in and we only read the
 * result, so there is no secret to store, leak or rotate — which is why this
 * suits a static site.
 */

/** Where Google publishes the keys it signs ID tokens with. */
const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';

/**
 * Google issues tokens under both spellings and has done for years. Accepting
 * only one rejects real tokens intermittently, depending on which Google decides
 * to use, which is the worst kind of authentication bug: it works when you test it.
 */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Fetched once per container and cached by jose, which also handles key rotation.
 * Built lazily so that constructing an identity never performs a network call —
 * a request with no token must be refused without asking Google anything.
 */
let googleKeys: JWTVerifyGetKey | undefined;
const defaultKeys = (): JWTVerifyGetKey => {
  googleKeys ??= createRemoteJWKSet(new URL(GOOGLE_CERTS));
  return googleKeys;
};

/**
 * @param presented the bearer token the caller sent, or null
 * @param clientId  our OAuth client id, which the token's audience must match
 * @param keys      overridden only by tests, which sign with their own keypair
 */
export function googleIdentity(
  presented: string | null,
  clientId: string,
  keys: JWTVerifyGetKey = defaultKeys(),
): CurrentIdentity {
  return {
    async current(): Promise<Maker | null> {
      // An unset client id authenticates nobody. Verifying against an empty
      // audience would accept tokens minted for any application on earth.
      if (presented === null || presented === '' || clientId === '') {
        return null;
      }

      try {
        const { payload } = await jwtVerify(presented, keys, {
          audience: clientId,
          issuer: GOOGLE_ISSUERS,
          // Pinned, so the algorithm is ours to decide rather than the token's.
          // A verifier that accepts whatever the header names is the shape of
          // every algorithm-substitution attack; Google signs these RS256.
          algorithms: ['RS256'],
          // OIDC Core allows a little leeway for clock drift. Lambda clocks are
          // NTP-disciplined so this is close to unnecessary, but a token refused
          // for being one second early is a confusing failure to debug.
          clockTolerance: '30s',
        });

        // sub is the account, and it is what gets stored. Email is deliberately
        // not used as the identity: Google's own guidance is that a user can
        // change it, so a tool published under one address could later be
        // attributed to whoever picks that address up.
        const sub = typeof payload.sub === 'string' ? payload.sub : '';
        if (sub === '') {
          return null;
        }

        const name = typeof payload.name === 'string' ? payload.name.trim() : '';
        return { id: { value: sub }, displayName: name === '' ? 'Maker' : name };
      } catch {
        // Expired, wrong audience, wrong issuer, bad signature, malformed — all
        // of them mean the same thing to a caller, and saying which would help
        // someone probing for a token this endpoint will accept.
        return null;
      }
    },
  };
}
