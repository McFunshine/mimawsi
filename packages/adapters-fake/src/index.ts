import type { Maker, ScanResult } from '@mimawsi/domain';
import type {
  IdentityPort, NotifiableEvent, NotifierPort, Ports, ScannerPort,
} from '@mimawsi/ports';
import { LocalDirectoryStorage } from './storage.ts';

export { LocalDirectoryStorage } from './storage.ts';

/**
 * The phase-0 fakes. Each one is the smallest thing that satisfies its contract —
 * they exist so the whole journey runs on a laptop, and each is deleted by the task
 * named in its comment. None of them may be relied on for behaviour the contract
 * does not state.
 */

/** Retired by task-3.4 (Google OAuth). Signs in one hardcoded maker, no network. */
export class StubIdentity implements IdentityPort {
  private signedIn: Maker | null = null;
  private readonly who: Maker;

  // Written longhand rather than as a parameter property: Node's type-stripping
  // runs these files directly and does not support that syntax.
  constructor(who: Maker = { id: { value: 'stub-maker' }, displayName: 'Stub Maker' }) {
    this.who = who;
  }

  async current(): Promise<Maker | null> {
    return this.signedIn;
  }

  async signIn(): Promise<Maker> {
    this.signedIn = this.who;
    return this.who;
  }

  async signOut(): Promise<void> {
    this.signedIn = null;
  }
}

/**
 * Retired by task-4.2 (semgrep in Actions). Passes everything, deliberately.
 * It must never grow real detection logic — a fake that half-scans invites the
 * belief that scanning is covered when it is not.
 */
export class AlwaysPassesScanner implements ScannerPort {
  async scan(_bytes: Uint8Array): Promise<ScanResult> {
    return { verdict: 'pass', findings: [] };
  }
}

/** Retired by task-5.4 (SES). Collects events so the tracer can assert one was sent. */
export class RecordingNotifier implements NotifierPort {
  readonly sent: NotifiableEvent[] = [];

  async notify(event: NotifiableEvent): Promise<void> {
    this.sent.push(event);
    process.stdout.write(`[notify] ${event.kind} -> ${event.maker.value}\n`);
  }
}

/** The whole fake world, wired. */
export function fakePorts(storageRoot: string): Ports {
  return {
    storage: new LocalDirectoryStorage(storageRoot),
    identity: new StubIdentity(),
    scanner: new AlwaysPassesScanner(),
    notifier: new RecordingNotifier(),
  };
}
