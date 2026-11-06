import { createSignal } from 'solid-js';
import { errorText, post } from '../api.ts';
import { Screen } from '../components/Screen.tsx';
import { Field } from '../components/Field.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';
import { focusOnEnter, useSubmitOnBareEnter } from '../keys.ts';

// YubiKey public ID: the first 12 modhex characters of its OTPs (a full OTP is accepted too)
const PUBLIC_ID = /^[cbdefghijklnrtuv]{12}([cbdefghijklnrtuv]{32})?$/;

// Lost YubiKey: puts the account into lockdown, no sign-in works until an admin lifts it.
export default function LostKey() {
  const [username, setUsername] = createSignal('');
  const [keyId, setKeyId] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [status, setStatus] = createSignal<StatusMessage>(null);
  let form: HTMLFormElement | undefined;

  useSubmitOnBareEnter(() => form);

  const onSubmit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (busy()) return;
    const id = keyId().trim().toLowerCase();
    if (!username() || !id) {
      setStatus({ kind: 'error', text: 'username and key ID are required' });
      return;
    }
    if (!PUBLIC_ID.test(id)) {
      setStatus({ kind: 'error', text: 'not a valid YubiKey ID' });
      return;
    }
    setBusy(true);
    setStatus({ kind: 'info', text: 'locking...' });
    try {
      await post('/yubikey/lost', { username: username(), publicId: id });
      setStatus({
        kind: 'info',
        text: 'If the username and key ID match, the account is now locked.',
      });
      return; // done: stay busy
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
    setBusy(false);
  };

  return (
    <Screen
      subtitle={
        <>
          Locking your account after a lost <span class="service-name">YubiKey</span>
        </>
      }
    >
      <form ref={form} onSubmit={onSubmit} autocomplete="on">
        <Field
          label="Username"
          name="username"
          autocomplete="username"
          autofocus
          value={username()}
          onInput={(e) => setUsername(e.currentTarget.value)}
          onKeyDown={focusOnEnter('keyId')}
        />
        <Field
          label="YubiKey ID"
          name="keyId"
          autocomplete="off"
          autocapitalize="off"
          maxLength={44}
          value={keyId()}
          onInput={(e) => setKeyId(e.currentTarget.value)}
        />
        <button class="submit" type="submit" disabled={busy()}>
          Lock
        </button>
        <p class="hint only-keyboard">Press Enter to lock the account.</p>
      </form>
      <Status message={status()} />
      <ul class="hint notes">
        <li>Locking stops every sign-in to the account, with the password or any key.</li>
        <li>Only an administrator can unlock it.</li>
        <li>
          The key ID is the first 12 characters of the key's OTP, as listed when you bound it.
        </li>
      </ul>
    </Screen>
  );
}
