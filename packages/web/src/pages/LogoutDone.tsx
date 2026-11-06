import { Screen } from '../components/Screen.tsx';

// Zitadel sends users here after logout when the app gave no post-logout redirect URI
export default function LogoutDone() {
  return (
    <Screen>
      <p>You have been signed out.</p>
      <p class="hint">You can close this window now.</p>
    </Screen>
  );
}
