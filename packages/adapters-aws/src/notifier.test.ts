import { describe, expect, it, vi } from 'vitest';
import { emailNotifier, rejectionEmail, FROM, REPLY_TO } from './notifier.ts';

describe('the rejection email', () => {
  it('leads with what happened and why, in that order', () => {
    const { subject, text } = rejectionEmail({
      reason: 'it reaches the network',
      remedy: 'remove the fetch call',
      title: 'Word Counter',
    });

    expect(subject).toBe('“Word Counter” was not published');
    expect(text).toContain('was not published on mimawsi.com');
    expect(text.indexOf('Why:')).toBeLessThan(text.indexOf('What would change that:'));
    expect(text).toContain('it reaches the network');
    expect(text).toContain('remove the fetch call');
  });

  it('omits the remedy section rather than printing an empty heading', () => {
    const { text } = rejectionEmail({ reason: 'no', remedy: '   ', title: 'A' });
    expect(text).not.toContain('What would change that:');
  });

  it('says the address is unmonitored and where to write instead', () => {
    const { text } = rejectionEmail({ reason: 'no', remedy: '', title: 'A' });
    // A verified domain lets SES send from an address with no mailbox behind it.
    // Saying so is the difference between a dead end and a conversation.
    expect(text).toContain('not monitored');
    expect(text).toContain(REPLY_TO);
  });

  it('still reads sensibly when the submission had no title', () => {
    const { subject, text } = rejectionEmail({ reason: 'no', remedy: '', title: '' });
    expect(subject).toBe('Your tool was not published');
    expect(text).toContain('Your tool was not published');
  });
});

describe('sending', () => {
  const send = () => {
    const ses = { send: vi.fn(async () => ({})) };
    return ses as unknown as Parameters<typeof emailNotifier>[0]['ses'] & { send: ReturnType<typeof vi.fn> };
  };

  it('sends a rejection to the address recorded against the submission', async () => {
    const ses = send();
    const notifier = emailNotifier({ ses, addressFor: async () => 'maker@example.com' });

    await notifier.notify({
      kind: 'rejected',
      submission: { value: 's1' },
      maker: { value: 'm1' },
      reason: 'because',
      remedy: '',
    });

    expect(ses.send).toHaveBeenCalledTimes(1);
    const call = ses.send.mock.calls[0] as [{ input: Record<string, any> }];
    const input = call[0].input;
    expect(input.Destination.ToAddresses).toEqual(['maker@example.com']);
    expect(input.FromEmailAddress).toBe(FROM);
    expect(input.ReplyToAddresses).toEqual([REPLY_TO]);
    expect(input.Content.Simple.Body.Text.Data).toContain('because');
  });

  it('sends nothing at all when the maker left no address', async () => {
    const ses = send();
    const notifier = emailNotifier({ ses, addressFor: async () => undefined });

    await notifier.notify({
      kind: 'rejected',
      submission: { value: 's1' },
      maker: { value: 'm1' },
      reason: 'because',
      remedy: '',
    });

    // Not an error. The operator token carries no address, and neither does an
    // account Google has not verified. The decision is recorded regardless.
    expect(ses.send).not.toHaveBeenCalled();
  });

  it('sends nothing on an approval, because the site itself is the notification', async () => {
    const ses = send();
    const notifier = emailNotifier({ ses, addressFor: async () => 'maker@example.com' });

    await notifier.notify({ kind: 'approved', submission: { value: 's1' }, maker: { value: 'm1' } });

    expect(ses.send).not.toHaveBeenCalled();
  });
});
