import { resetLocalState } from './reset-local-state.ts';

/**
 * Phase-0 reset, after the run. Without this the tracer's published tool and the
 * catalogue index it rewrote are left in the working tree as untracked files,
 * one commit away from shipping a test fixture as product content.
 */
export default async function globalTeardown(): Promise<void> {
  await resetLocalState();
}
