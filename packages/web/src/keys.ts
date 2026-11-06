import { onCleanup, onMount } from 'solid-js';

/** Enter that isn't committing an IME composition (e.g. a Chinese input method). */
export const isPlainEnter = (e: KeyboardEvent) => e.key === 'Enter' && !e.isComposing;

/** Submit `form` when Enter is pressed while nothing on the page has focus. */
export function useSubmitOnBareEnter(form: () => HTMLFormElement | undefined) {
  const onKeyDown = (e: KeyboardEvent) => {
    const active = document.activeElement;
    if (!isPlainEnter(e) || (active && active !== document.body)) return;
    e.preventDefault();
    form()?.requestSubmit();
  };
  onMount(() => document.addEventListener('keydown', onKeyDown));
  onCleanup(() => document.removeEventListener('keydown', onKeyDown));
}
