import { Show, type JSX, type ParentComponent } from 'solid-js';
import { serviceName } from '../state.ts';

export const TITLE = 'LamaCloud Centralized Auth';

/** `subtitle` replaces the "Signing in to <app>" line. */
export const Screen: ParentComponent<{ subtitle?: JSX.Element }> = (props) => (
  <main class="screen">
    <div class="terminal">
      <header class="header">
        <h1 class="title">{TITLE}</h1>
        <Show
          when={props.subtitle === undefined}
          fallback={<p class="service">{props.subtitle}</p>}
        >
          <Show when={serviceName()}>
            {(name) => (
              <p class="service">
                Signing in to <span class="service-name">{name()}</span>
              </p>
            )}
          </Show>
        </Show>
      </header>
      {props.children}
    </div>
  </main>
);
