import { createEffect, createSignal } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { errorText, post, type StepResult } from '../api.ts';
import { authRequestId, loginHint } from '../state.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { isPlainEnter, useSubmitOnBareEnter } from '../keys.ts';

export default function Login() {
  const navigate = useNavigate();
  const routerLocation = useLocation<{ error?: string }>();
  const [username, setUsername] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  // an error handed over by a later step that sent us back here
  const initialError = routerLocation.state?.error;
  const [status, setStatus] = createSignal<StatusMessage>(
    initialError ? { kind: 'error', text: initialError } : null,
  );

  // prefill the username suggested by the app, unless the user already typed one
  createEffect(() => {
    const hint = loginHint();
    if (hint && !username()) setUsername(hint);
  });
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
      const res = await post<StepResult>('/login', {
        authRequest: authRequestId(),
        username: username(),
        password: password(),
      });
      if ('redirect' in res) {
        window.location.assign(res.redirect); // stay busy while the browser leaves
        return;
      }
      setStatus(null);
      navigate('/otp');
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

  const onRegister = () => {
    // TODO: registration flow
    setStatus({ kind: 'info', text: 'registration is not available yet' });
  };

  return (
    <Screen>
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
        {/* lets Enter submit a multi-field form; disabled while busy to block double submits */}
        <button class="submit" type="submit" disabled={busy()}>
          Sign in
        </button>
        <p class="hint">
          <span class="only-keyboard">Press Enter to sign in, or </span>
          <span class="only-touch">Or </span>
          <button class="link" type="button" onClick={onRegister}>
            register
          </button>{' '}
          a new account.
        </p>
      </form>
      <Status message={status()} />
    </Screen>
  );
}
