import { createSignal } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { errorText, post } from '../api.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { isPlainEnter, useSubmitOnBareEnter } from '../keys.ts';

/** Header line of the YubiKey binding pages. */
export const BIND_SUBTITLE = (
  <>
    Binding a <span class="service-name">YubiKey</span> to your account
  </>
);

// Step 1 of binding a YubiKey: a copy of the login page.
export default function BindStart() {
  const navigate = useNavigate();
  const routerLocation = useLocation<{ error?: string }>();
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // an error handed over by the next step that sent us back here
  const initialError = routerLocation.state?.error;
  const [status, setStatus] = createSignal<StatusMessage>(
    initialError ? { kind: 'error', text: initialError } : null,
  );
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    if (!username() || !password()) {
      setStatus({ kind: 'error', text: 'username and password are required' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'authenticating...' });
    try {
      await post('/yubikey/start', { username: username(), password: password() });
      setStatus(null);
      navigate('/yubikey/otp');
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  // Enter in the username field moves on to the password instead of submitting
  const onUsernameKeyDown = (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    (e.currentTarget.form?.elements.namedItem('password') as HTMLInputElement | null)?.focus();
  };

  return (
    <Screen subtitle={BIND_SUBTITLE}>
      <form ref={form} onSubmit={onSubmit} autocomplete="on">
        <Field
          label="Username"
          name="username"
          autocomplete="username"
          autofocus
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          onKeyDown={onUsernameKeyDown}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autocomplete="current-password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
        />
        <button class="submit" type="submit" disabled={busy()}>
          Continue
        </button>
        <p class="hint">
          <span class="only-keyboard">
            Press Enter to continue.
            <br />
          </span>
          Lost your YubiKey?{' '}
          <button class="link" type="button" onClick={() => navigate('/yubikey/lost')}>
            Lock
          </button>{' '}
          your account.
        </p>
      </form>
      <Status message={status()} />
      <ul class="hint notes">
        <li>Once bound, the YubiKey is you. Your password matters less than the key.</li>
        <li>Touch the key in the Password field to sign in. No password needed.</li>
        <li>Signing in with your password asks for the key as well.</li>
        <li>Whoever holds the key can sign in as you. Keep it safe.</li>
        <li>Already have a key bound? Touch it in the Password field to add another one.</li>
      </ul>
    </Screen>
  );
}
