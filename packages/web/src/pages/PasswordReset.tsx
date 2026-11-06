import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { errorText, post } from '../api.ts';
import { loginHint } from '../state.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { useSubmitOnBareEnter } from '../keys.ts';

/** Header line of the password reset pages. */
export const RESET_SUBTITLE = (
  <>
    Resetting your <span class="service-name">password</span> by email
  </>
);

// Step 1 of a password reset: Zitadel emails a code (and a link carrying it).
export default function PasswordReset() {
  const navigate = useNavigate();
  const [username, setUsername] = createSignal(loginHint() ?? '');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(null);
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    if (!username()) {
      setStatus({ kind: 'error', text: 'username is required' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'sending...' });
    try {
      await post('/password/reset', { username: username() });
      navigate('/password/set');
      return;
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <Screen subtitle={RESET_SUBTITLE}>
      <form ref={form} onSubmit={onSubmit} autocomplete="on">
        <Field
          label="Username"
          name="username"
          autocomplete="username"
          autofocus
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
        />
        <button class="submit" type="submit" disabled={busy()}>
          Send code
        </button>
        <p class="hint only-keyboard">Press Enter to email a reset code.</p>
      </form>
      <Status message={status()} />
    </Screen>
  );
}
