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

/** keydown handler: Enter moves focus to the form field named `next` instead of submitting. */
export const focusOnEnter =
  (next: string) => (e: KeyboardEvent & { currentTarget: HTMLInputElement }) => {
    if (!isPlainEnter(e)) return;
    e.preventDefault();
    (e.currentTarget.form?.elements.namedItem(next) as HTMLInputElement | null)?.focus();
  };
