import { A } from '@solidjs/router';
import { Screen } from '../components/Screen.tsx';

export default function NotFound() {
  return (
    <Screen>
      <p>404: no such page</p>
      <p class="hint">
        <A class="link" href="/">
          Go back
        </A>{' '}
        to sign in.
      </p>
    </Screen>
  );
}
