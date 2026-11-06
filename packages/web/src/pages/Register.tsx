import { createSignal, Show } from 'solid-js';
import { errorText, post } from '../api.ts';
import { authRequestId, serviceName } from '../state.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { focusOnEnter, useSubmitOnBareEnter } from '../keys.ts';

// Yubico OTP: 12 char public id + 32 char token, modhex encoded (44 chars total)
const YUBICO_OTP = /^[cbdefghijklnrtuv]{44}$/;

// A copy of the login page with an email and an optional Yubico OTP field.
export default function Register() {
  const [username, setUsername] = createSignal('');
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [otp, setOtp] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(null);
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  // the YubiKey types the OTP and presses Enter, which submits the form
  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    if (!username() || !email() || !password()) {
      setStatus({ kind: 'error', text: 'username, email and password are required' });
      return;
    }
    const key = otp().trim().toLowerCase();
    if (key && !YUBICO_OTP.test(key)) {
      setStatus({ kind: 'error', text: 'not a valid Yubico OTP' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'creating account...' });
    try {
      const res = await post<{ redirect: string } | { registered: true }>('/register', {
        authRequest: authRequestId(),
        username: username(),
        email: email(),
        password: password(),
        otp: key || undefined,
      });
      if ('redirect' in res) {
        window.location.assign(res.redirect); // stay busy while the browser leaves
        return;
      }
      setStatus({
        kind: 'info',
        text: 'Account created. Check your inbox to verify your email address.',
      });
      return; // done: stay busy
    } catch (err) {
      setOtp('');
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <Screen
      subtitle={
        <>
          Creating an account
          <Show when={serviceName()}>
            {(name) => (
              <>
                {' '}
                for <span class="service-name">{name()}</span>
              </>
            )}
          </Show>
        </>
      }
    >
      <form ref={form} onSubmit={onSubmit} autocomplete="on" novalidate>
        <Field
          label="Username"
          name="username"
          autocomplete="username"
          autofocus
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          onKeyDown={focusOnEnter('email')}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autocomplete="email"
          value={email()}
          onInput={(e) => setEmail(e.currentTarget.value)}
          onKeyDown={focusOnEnter('password')}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autocomplete="new-password"
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={focusOnEnter('otp')}
        />
        <Field
          label="Yubico OTP"
          name="otp"
          autocomplete="off"
          autocapitalize="off"
          placeholder="optional"
          maxLength={44}
          value={otp()}
          onInput={(e) => setOtp(e.currentTarget.value)}
        />
        <button class="submit" type="submit" disabled={busy()}>
          Register
        </button>
        <p class="hint only-keyboard">Press Enter to register.</p>
      </form>
      <Status message={status()} />
      <ul class="hint notes">
        <li>Touch your YubiKey in the Yubico OTP field to bind it, or leave it empty.</li>
        <li>With a key bound, the key is you: touch it in the Password field to sign in.</li>
        <li>You will get an email to verify your address.</li>
      </ul>
    </Screen>
  );
}
