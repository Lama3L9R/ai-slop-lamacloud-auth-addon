import { createSignal, Show } from 'solid-js';
import { A } from '@solidjs/router';
import { errorText, post } from '../api.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { focusOnEnter, useSubmitOnBareEnter } from '../keys.ts';
import { RESET_SUBTITLE } from './PasswordReset.tsx';

// Step 2 of a password reset: the code from the email (prefilled when opened from its link).
export default function PasswordSet() {
  const query = new URLSearchParams(location.search);
  const fromLink = query.get('code') ?? '';
  const userId = query.get('userId') ?? undefined;
  const [code, setCode] = createSignal(fromLink);
  const [password, setPassword] = createSignal('');
  const [repeat, setRepeat] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [done, setDone] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(
    fromLink ? null : { kind: 'info', text: 'If the account exists, a code is on its way.' },
  );
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    if (!code() || !password()) {
      setStatus({ kind: 'error', text: 'code and new password are required' });
      return;
    }
    if (password() !== repeat()) {
      setStatus({ kind: 'error', text: 'passwords do not match' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'saving...' });
    try {
      await post('/password/set', { code: code(), password: password(), userId });
      setStatus(null);
      setDone(true);
      return; // done: stay busy
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <Screen subtitle={RESET_SUBTITLE}>
      <Show
        when={!done()}
        fallback={
          <>
            <p>Your password has been changed.</p>
            <p class="hint">
              <A class="link" href="/">
                Sign in
              </A>{' '}
              with your new password.
            </p>
          </>
        }
      >
        <form ref={form} onSubmit={onSubmit} autocomplete="on">
          <Field
            label="Code"
            name="code"
            autocomplete="one-time-code"
            autocapitalize="off"
            autofocus={!fromLink}
            value={code()}
            onInput={(e) => setCode(e.currentTarget.value)}
            onKeyDown={focusOnEnter('password')}
          />
          <Field
            label="New password"
            name="password"
            type="password"
            autocomplete="new-password"
            autofocus={!!fromLink}
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={focusOnEnter('repeat')}
          />
          <Field
            label="Repeat"
            name="repeat"
            type="password"
            autocomplete="new-password"
            value={repeat()}
            onInput={(e) => setRepeat(e.currentTarget.value)}
          />
          <button class="submit" type="submit" disabled={busy()}>
            Set password
          </button>
          <p class="hint only-keyboard">Press Enter to set the new password.</p>
        </form>
        <Status message={status()} />
      </Show>
    </Screen>
  );
}
