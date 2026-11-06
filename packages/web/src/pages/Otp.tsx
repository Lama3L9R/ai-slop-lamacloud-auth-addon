import { createSignal } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { ApiError, errorText, leave, post, type Leave } from '../api.ts';
import { withAppRequest } from '../state.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { useSubmitOnBareEnter } from '../keys.ts';

// Yubico OTP: 12 char public id + 32 char token, modhex encoded (44 chars total)
const YUBICO_OTP = /^[cbdefghijklnrtuv]{44}$/;

export default function Otp() {
  const navigate = useNavigate();
  const [otp, setOtp] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(null);
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  // The YubiKey types the OTP and presses Enter, which submits the form.
  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const value = otp().trim().toLowerCase();
    if (!YUBICO_OTP.test(value)) {
      setStatus({ kind: 'error', text: 'not a valid Yubico OTP' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'verifying...' });
    try {
      leave(await post<Leave>('/otp', { otp: value })); // stay busy while the browser leaves
      return;
    } catch (err) {
      if (err instanceof ApiError && err.restart) {
        navigate(withAppRequest('/login'), {
          state: { error: err.message },
        });
        return;
      }
      setOtp('');
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <Screen>
      <form ref={form} onSubmit={onSubmit}>
        <Field
          label="Yubico OTP"
          name="otp"
          autocomplete="off"
          autocapitalize="off"
          autofocus
          maxLength={44}
          value={otp()}
          onInput={(e) => setOtp(e.currentTarget.value)}
        />
        <button class="submit" type="submit" disabled={busy()}>
          Continue
        </button>
        <p class="hint">Touch your YubiKey to continue.</p>
      </form>
      <Status message={status()} />
    </Screen>
  );
}
