import { describe, expect, it } from 'vitest';
import { OPERATOR, operatorIdentity } from './identity.ts';

describe('operatorIdentity', () => {
  it('recognises the operator when the right token is presented', async () => {
    expect(await operatorIdentity('s3cret', 's3cret').current()).toEqual(OPERATOR);
  });

  it('recognises nobody when the token is wrong', async () => {
    expect(await operatorIdentity('wrong', 's3cret').current()).toBeNull();
  });

  it('recognises nobody when no token is presented', async () => {
    expect(await operatorIdentity(null, 's3cret').current()).toBeNull();
  });

  it('recognises nobody when no token is configured, rather than everybody', async () => {
    // The failure this exists to prevent: a Lambda deployed without its secret
    // set, authenticating every anonymous caller because the check compared two
    // empty strings and found them equal.
    expect(await operatorIdentity('', '').current()).toBeNull();
    expect(await operatorIdentity(null, '').current()).toBeNull();
    expect(await operatorIdentity('anything', '').current()).toBeNull();
  });

  it('does not accept a token that merely starts the same way', async () => {
    expect(await operatorIdentity('s3cretX', 's3cret').current()).toBeNull();
    expect(await operatorIdentity('s3cre', 's3cret').current()).toBeNull();
  });
});
