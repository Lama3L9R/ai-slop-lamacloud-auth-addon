import { createUniqueId, onMount, splitProps, type JSX } from 'solid-js';

type FieldProps = JSX.InputHTMLAttributes<HTMLInputElement> & { label: string };

export function Field(props: FieldProps) {
  const [local, input] = splitProps(props, ['label', 'id', 'autofocus']);
  const id = local.id ?? createUniqueId();
  let ref!: HTMLInputElement;

  // native `autofocus` only fires on full page load, not after client-side navigation
  onMount(() => {
    if (local.autofocus) ref.focus();
  });

  return (
    <div class="field">
      <label for={id}>{local.label}</label>
      <input ref={ref} id={id} spellcheck={false} {...input} />
    </div>
  );
}
