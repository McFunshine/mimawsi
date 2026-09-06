import type { Tool } from '@mimawsi/domain';

/**
 * Telling the two repositories that a tool was published.
 *
 * Publishing writes bytes to S3, and that is the whole of what makes a tool
 * *reachable*. Two other things have to happen for it to be *correct*, and
 * neither can be done from a Lambda:
 *
 *   - the catalogue lists tools from `published.json`, a committed file the site
 *     is built from, so a tool published without it is served at its URL and
 *     appears nowhere;
 *   - `mimawsi_external` is the public record of what is published, and a record
 *     that misses a publish is the one failure it cannot have.
 *
 * Both are git operations, so both are dispatches to a workflow rather than
 * writes from here. Each repository's workflow then edits only its own contents,
 * using the token GitHub gives it — which is why this holds a dispatch-only
 * credential and no write access to anything.
 *
 * A dispatch that fails must never fail the publish. The tool is already live by
 * the time this runs; turning a missed webhook into a 500 would tell the approver
 * their approval failed when it did not, and a second attempt would republish
 * something already published.
 */

export interface DispatchTarget {
  /** `owner/repo`. */
  readonly repo: string;
  /** Matches `types:` on the workflow's repository_dispatch trigger. */
  readonly eventType: string;
}

export interface DispatcherDeps {
  /** Fine-grained PAT whose only permission is to trigger a workflow. */
  readonly token: string;
  readonly targets: readonly DispatchTarget[];
  /** Injected so a test needs no network. */
  readonly fetch?: typeof globalThis.fetch;
  readonly log?: (message: string, detail?: unknown) => void;
}

export interface PublishedNotice {
  readonly tool: Tool;
  /** Directory name in the record repository. Derived from the title, never the id. */
  readonly slug: string;
  /** The approver's note, if they wrote one. Becomes REVIEW.md. */
  readonly note?: string | undefined;
  /** Who approved it, for the record. Display name, not an address. */
  readonly approvedBy: string;
}

/**
 * A folder name a human can read, from a title a human wrote.
 *
 * Falls back to the id rather than to an empty string: a title of "!!!" is
 * unusual but legal, and a folder called "" would fail in a way that has nothing
 * to do with the cause.
 */
export function slugFor(tool: Tool): string {
  const slug = tool.metadata.title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug === '' ? tool.id.value : slug;
}

export interface Dispatcher {
  /** Resolves to the targets that accepted. Never throws. */
  announce(notice: PublishedNotice): Promise<readonly string[]>;
}

export function githubDispatcher(deps: DispatcherDeps): Dispatcher {
  const send = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? ((message: string, detail?: unknown) => console.warn(message, detail));

  return {
    async announce(notice: PublishedNotice): Promise<readonly string[]> {
      if (deps.token === '') {
        // Not an error. A deployment without a token still publishes correctly;
        // it just leaves the catalogue and the record to be caught up by hand.
        log('no dispatch token configured, skipping repository dispatch');
        return [];
      }

      const payload = {
        // Flat and small. repository_dispatch payloads are size-limited, and the
        // bytes are deliberately not in here: the record workflow fetches them
        // from the live site, which is the same check the README asks readers to
        // perform, so the record cannot claim a hash the site does not serve.
        id: notice.tool.id.value,
        slug: notice.slug,
        title: notice.tool.metadata.title,
        description: notice.tool.metadata.description,
        // The submitted hash, as the store records it — the catalogue entry this
        // builds must match what `npm run publish` would have written, or the two
        // publishing paths produce different files for the same tool.
        sha256: notice.tool.sha256,
        sizeBytes: notice.tool.sizeBytes,
        maker: notice.tool.maker,
        approvedBy: notice.approvedBy,
        note: notice.note ?? '',
      };

      const accepted: string[] = [];
      await Promise.all(
        deps.targets.map(async (target) => {
          try {
            const response = await send(`https://api.github.com/repos/${target.repo}/dispatches`, {
              method: 'POST',
              headers: {
                accept: 'application/vnd.github+json',
                authorization: `Bearer ${deps.token}`,
                'content-type': 'application/json',
                'x-github-api-version': '2022-11-28',
                'user-agent': 'mimawsi-admin',
              },
              body: JSON.stringify({ event_type: target.eventType, client_payload: payload }),
            });

            if (response.status === 204) {
              accepted.push(target.repo);
              return;
            }
            log(`dispatch to ${target.repo} refused`, {
              status: response.status,
              body: (await response.text()).slice(0, 300),
            });
          } catch (error) {
            // Swallowed on purpose. See the note at the top: the tool is already
            // published, and failing the approval would misreport that.
            log(`dispatch to ${target.repo} failed`, error);
          }
        }),
      );

      return accepted;
    },
  };
}
