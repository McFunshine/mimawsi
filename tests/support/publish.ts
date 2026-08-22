import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOL_CSP } from './policy';

/**
 * Stand-in for the publish-time CSP injector (task-1.5 / RULE-45). Once the real
 * parse5 injector exists, this function MUST delegate to it rather than build its
 * own markup — RULE-45 exists so the injector and this harness cannot diverge.
 */
export function injectCsp(toolHtml: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${TOOL_CSP}">`;
  if (/<head[^>]*>/i.test(toolHtml)) {
    return toolHtml.replace(/<head[^>]*>/i, (head) => `${head}${meta}`);
  }
  return `<!doctype html><html><head>${meta}</head><body>${toolHtml}</body></html>`;
}

/** Writes a published tool to disk and returns the `file://` URL a downloader would open. */
export async function publishToDisk(toolHtml: string, name = 'tool.html'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mimawsi-'));
  const path = join(dir, name);
  await writeFile(path, injectCsp(toolHtml), 'utf8');
  return pathToFileURL(path).href;
}
