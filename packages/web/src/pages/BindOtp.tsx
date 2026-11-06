import { createSignal, For, onMount, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { api, ApiError, errorText, post } from '../api.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { useSubmitOnBareEnter } from '../keys.ts';
import { BIND_SUBTITLE } from './BindStart.tsx';

// Yubico OTP: 12 char public id + 32 char token, modhex encoded (44 chars total)
const YUBICO_OTP = /^[cbdefghijklnrtuv]{44}$/;

type Keys = { publicIds: string[] };

// Step 2 of binding a YubiKey: the bound keys, each can be deactivated; the OTP field binds another.
export default function BindOtp() {
  const navigate = useNavigate();
  const [keys, setKeys] = createSignal<string[]>();
  const [otp, setOtp] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(null);
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  /** Runs a request; a gone flow sends the user back to step 1. Returns undefined on failure. */
  const call = async <T,>(request: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await request();
    } catch (err) {
      if (err instanceof ApiError && err.restart) {
        navigate('/yubikey', { state: { error: err.message } });
      } else {
        setStatus({ kind: 'error', text: errorText(err) });
      }
      return undefined;
    }
  };

  onMount(async () => {
    const res = await call(() => api<Keys>('/yubikey/keys'));
    if (res) setKeys(res.publicIds);
  });

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
    const res = await call(() =>
      post<Keys & { publicId: string }>('/yubikey/bind', { otp: value }),
    );
    setOtp('');
    if (res) {
      setKeys(res.publicIds);
      setStatus({
        kind: 'info',
        text: `YubiKey ${res.publicId} is bound. You can sign in with it now.`,
      });
    }
    setBusy(false);
  };

  const deactivate = async (publicId: string) => {
    if (busy()) return;
    setBusy(true);
    setStatus({ kind: 'info', text: 'deactivating...' });
    const res = await call(() => post<Keys>('/yubikey/deactivate', { publicId }));
    if (res) {
      setKeys(res.publicIds);
      setStatus({ kind: 'info', text: `YubiKey ${publicId} is deactivated.` });
    }
    setBusy(false);
  };

  return (
    <Screen subtitle={BIND_SUBTITLE}>
      <Show when={keys()}>
        {(ids) => (
          <div class="keys">
            <span class="keys-label">Bound keys</span>
            <ul class="keys-list">
              <For each={ids()} fallback={<li class="dim">none</li>}>
                {(id) => (
                  <li>
                    {id}{' '}
                    <button
                      class="action"
                      type="button"
                      disabled={busy()}
                      onClick={() => void deactivate(id)}
                    >
                      Deactivate
                    </button>
                  </li>
                )}
              </For>
            </ul>
          </div>
        )}
      </Show>
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
        <p class="hint">Touch the YubiKey you want to bind.</p>
      </form>
      <Status message={status()} />
    </Screen>
  );
}
