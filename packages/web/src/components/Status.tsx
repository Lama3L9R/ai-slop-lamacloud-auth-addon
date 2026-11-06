export type StatusMessage = { kind: 'info' | 'error'; text: string } | null;

export function Status(props: { message: StatusMessage }) {
  return (
    <div class="status" classList={{ error: props.message?.kind === 'error' }} role="status">
      {props.message?.text}
    </div>
  );
}
