import type { Action } from '../platform';

export interface View {
  element: HTMLElement;
  render(): void;
  handle(action: Action): boolean;
  pointer(target: HTMLElement): void;
  enter(): void;
  refreshClock?(): void;
}
