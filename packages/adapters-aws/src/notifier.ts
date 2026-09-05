import { SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import type { NotifiableEvent, NotifierPort } from '@mimawsi/ports';

/**
 * Telling a maker their submission was refused, by email.
 *
 * Only rejections are sent. An approval announces itself — the tool appears on
 * the site — and a message saying so would be a second notification of something
 * the maker can already see. A rejection is the only outcome that is invisible
 * from outside, and the only one where silence is indistinguishable from being
 * ignored.
 *
 * The address comes from the submission record, captured at submit time from a
 * Google `email_verified` claim. It is never looked up from the allowlist and
 * never derived from the `sub`: the point is to reach the person who sent this
 * file, not whoever currently holds an address.
 */

/**
 * A verified *domain* lets SES send from any address at it, so this mailbox does
 * not exist and no one is reading it. That is why every message carries a
 * Reply-To pointing somewhere a human does read.
 */
export const FROM = 'no-reply@mimawsi.com';
export const REPLY_TO = 'hello@mimawsi.com';

export interface EmailNotifierDeps {
  readonly ses?: SESv2Client;
  /** Where to send. Absent means the maker left no verified address. */
  readonly addressFor: (submission: string) => Promise<string | undefined>;
  /** Overridable so a test can assert the body without an SES account. */
  readonly from?: string;
  readonly replyTo?: string;
}

/** Subject and body, separated from sending so both can be tested directly. */
export function rejectionEmail(event: {
  reason: string;
  remedy: string;
  title?: string | undefined;
}): { subject: string; text: string } {
  const what = event.title === undefined || event.title === '' ? 'Your tool' : `“${event.title}”`;

  // Plain text only. A tool submission is a technical exchange, the message is
  // six lines, and an HTML part would double the surface for no gain — including
  // the surface where a maker's own title lands inside markup.
  const text = [
    `${what} was not published on mimawsi.com.`,
    '',
    'Why:',
    event.reason,
    ...(event.remedy.trim() === '' ? [] : ['', 'What would change that:', event.remedy]),
    '',
    'You are welcome to fix it and submit again — https://www.mimawsi.com/share',
    '',
    'This address is not monitored. Reply to ' + REPLY_TO + ' if you want to discuss it.',
  ].join('\n');

  return { subject: `${what} was not published`, text };
}

export function emailNotifier(deps: EmailNotifierDeps): NotifierPort {
  const from = deps.from ?? FROM;
  const replyTo = deps.replyTo ?? REPLY_TO;

  return {
    async notify(event: NotifiableEvent): Promise<void> {
      if (event.kind !== 'rejected') {
        return;
      }

      const to = await deps.addressFor(event.submission.value);
      // No address is a normal outcome, not a failure: the operator token carries
      // none, and neither does an account whose address Google has not verified.
      // The decision and its reason are already recorded either way.
      if (to === undefined || to === '') {
        return;
      }

      const { subject, text } = rejectionEmail(event);
      const ses = deps.ses ?? new SESv2Client({});
      await ses.send(
        new SendEmailCommand({
          FromEmailAddress: from,
          Destination: { ToAddresses: [to] },
          ReplyToAddresses: [replyTo],
          Content: {
            Simple: {
              Subject: { Data: subject, Charset: 'UTF-8' },
              Body: { Text: { Data: text, Charset: 'UTF-8' } },
            },
          },
        }),
      );
    },
  };
}
