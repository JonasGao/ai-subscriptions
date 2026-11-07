// The modal dialog contract the world committed to (`div role="dialog"`):
// focus moves in on open, Tab wraps inside the dialog, Escape closes, and
// focus returns to the trigger when the dialog leaves the DOM. Every dialog
// element wires this once; nothing else manages dialog focus.

import type { JSX } from "solid-js";

const FOCUSABLE_SELECTOR = [
  "a[href]:not([disabled])",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

export interface DialogFocusHandle {
  /** Attach to the dialog element's ref. */
  ref: (element: HTMLElement) => void;
  /** Attach to the dialog element's onKeyDown. */
  onKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>;
}

/**
 * createDialogFocus implements the dialog focus cycle. The dialog element
 * needs `tabindex="-1"` so it can hold focus when it has no focusable child
 * (e.g. plain confirmations rendered before their buttons).
 *
 * Focus returns to the trigger when the dialog element is removed from the
 * document — whatever closed it (Escape, 取消, a successful submit) unmounts
 * the dialog, so the removal observer covers every path.
 */
export function createDialogFocus(close: () => void): DialogFocusHandle {
  let dialog: HTMLElement | null = null;
  let restoreTo: HTMLElement | null = null;

  const focusables = (): HTMLElement[] =>
    dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      : [];

  // Fires on any DOM mutation while attached; disconnects itself as soon as
  // the dialog leaves the document, then gives focus back. The hook never
  // disconnects it from a component cleanup: disposal order there can run
  // before the removal mutation is delivered, dropping the record.
  const observer = new MutationObserver(() => {
    if (dialog && !dialog.isConnected) {
      observer.disconnect();
      dialog = null;
      if (restoreTo?.isConnected) restoreTo.focus();
    }
  });

  const ref = (element: HTMLElement) => {
    dialog = element;
    restoreTo =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    // The template ref fires before the element is attached to the
    // document, and focus() on a detached node is a no-op: focus in a
    // microtask, once insertion has happened.
    queueMicrotask(() => {
      if (dialog === element && element.isConnected) {
        // Confirmations focus their first button (取消), forms their first
        // field; the dialog itself is the fallback.
        (focusables()[0] ?? element).focus();
      }
    });
  };

  const onKeyDown: JSX.EventHandler<HTMLElement, KeyboardEvent> = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === dialog)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || active === dialog)) {
      event.preventDefault();
      first.focus();
    }
  };

  return {
    ref,
    onKeyDown: onKeyDown as JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>,
  };
}
