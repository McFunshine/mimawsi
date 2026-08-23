import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempRoot } from './temp';
import { pathToFileURL } from 'node:url';
import { injectCsp } from '../../packages/injector/src/index.ts';
/**
 * The real injector, not a copy of it. Whatever task-1.5 replaces the
 * implementation with, these specs test that and nothing else (RULE-45).
 */
export { injectCsp } from '../../packages/injector/src/index.ts';

/** Writes a published tool to disk and returns the `file://` URL a downloader would open. */
export async function publishToDisk(toolHtml: string, name = 'tool.html'): Promise<string> {
  const dir = await mkdtemp(join(tempRoot(), 'mimawsi-'));
  const path = join(dir, name);
  await writeFile(path, injectCsp(toolHtml), 'utf8');
  return pathToFileURL(path).href;
}
