import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeIdentityPort, describeNotifierPort, describeScannerPort, describeStoragePort,
} from '@mimawsi/ports/contracts';
import { AlwaysPassesScanner, LocalDirectoryStorage, RecordingNotifier, StubIdentity } from './index.ts';

// TC-T04. These same four calls run against the AWS adapters at tasks 3.4, 3.5,
// 4.2 and 5.4 — with the contract suites untouched (RULE-46).
describeStoragePort(
  'LocalDirectoryStorage',
  async () => new LocalDirectoryStorage(await mkdtemp(join(tmpdir(), 'mimawsi-store-'))),
);
describeIdentityPort('StubIdentity', async () => new StubIdentity());
describeScannerPort('AlwaysPassesScanner', async () => new AlwaysPassesScanner());
describeNotifierPort('RecordingNotifier', async () => new RecordingNotifier());
