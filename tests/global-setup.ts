import { resetLocalState } from './reset-local-state.ts';

/** Phase-0 reset, before the run. See reset-local-state for why it exists. */
export default async function globalSetup(): Promise<void> {
  await resetLocalState();
}
