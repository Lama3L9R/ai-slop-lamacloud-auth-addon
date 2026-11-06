import { createSignal, onMount } from 'solid-js';
import { errorText, post } from '../api.ts';
import { Screen } from '../components/Screen.tsx';
import { Status, type StatusMessage } from '../components/Status.tsx';

// Opened from the link in Zitadel's verification email: /verify?userId=...&code=...
export default function VerifyEmail() {
  const [status, setStatus] = createSignal<StatusMessage>({ kind: 'info', text: 'verifying...' });
  const [done, setDone] = createSignal(false);

  onMount(async () => {
    const query = new URLSearchParams(location.search);
    const userId = query.get('userId');
    const code = query.get('code');
    if (!userId || !code) {
      setStatus({ kind: 'error', text: 'this link is incomplete, open it from the email again' });
      return;
    }
    try {
      await post('/email/verify', { userId, code });
      setStatus(null);
      setDone(true);
    } catch (err) {
      setStatus({ kind: 'error', text: errorText(err) });
    }
  });

  return (
    <Screen
      subtitle={
        <>
          Verifying your <span class="service-name">email address</span>
        </>
      }
    >
      {done() && (
        <>
          <p>Your email address is verified.</p>
          <p class="hint">You can close this window now.</p>
        </>
      )}
      <Status message={status()} />
    </Screen>
  );
}
