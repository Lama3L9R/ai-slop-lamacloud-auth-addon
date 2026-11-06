import { Show, type ParentComponent } from 'solid-js';
import { serviceName } from '../state.ts';

export const TITLE = 'LamaCloud Centralized Auth';

export const Screen: ParentComponent = (props) => (
  <main class="screen">
    <div class="terminal">
      <header class="header">
        <h1 class="title">{TITLE}</h1>
        <Show when={serviceName()}>
          {(name) => (
            <p class="service">
              Signing in to <span class="service-name">{name()}</span>
            </p>
          )}
        </Show>
      </header>
      {props.children}
    </div>
  </main>
);
