// The drag seam for sortable rows (#35). Rows read the solid-dnd sortable
// primitives through this module so rendering tests can substitute an inert
// implementation (the old stack mocked @dnd-kit/sortable the same way).
//
// The pointer sensor is registered by DragDropSensors' onMount, so the drag
// handlers are attached from the row's onMount rather than during render.

import { onCleanup, onMount, type JSX } from "solid-js";
import {
  createSortable,
  maybeTransformStyle,
  useDragDropContext,
} from "@thisbeyond/solid-dnd";

/** SortableRow is what a row needs to become draggable. */
export interface SortableRow {
  /** Element ref for the sortable wrapper. */
  ref: (element: HTMLElement) => void;
  /** Ref for the drag handle; registers solid-dnd's pointer activators. */
  attach: (element: HTMLElement) => void;
  /** Static accessibility attributes for the drag handle. */
  attrs: Record<string, string | number>;
  /** Solid-dnd transform for the wrapper's inline style. */
  style: () => JSX.CSSProperties;
  /** True while this row is the one being dragged. */
  isActive: () => boolean;
}

function inertRow(): SortableRow {
  return {
    ref: () => undefined,
    attach: () => undefined,
    attrs: {},
    style: () => ({}),
    isActive: () => false,
  };
}

/**
 * useSortableRow registers a sortable row with the surrounding DragDropProvider
 * and SortableProvider. Outside a provider it degrades to an inert row, so the
 * list can be rendered (and tested) standalone.
 */
export function useSortableRow(id: string): SortableRow {
  if (!useDragDropContext()) {
    return inertRow();
  }
  const sortable = createSortable(id);

  const attach = (element: HTMLElement) => {
    onMount(() => {
      const listeners = Object.entries(sortable.dragActivators);
      for (const [event, handler] of listeners) {
        // solid-dnd keys are JSX-style ("onpointerdown"); strip the "on" prefix.
        const domEvent = event.startsWith("on") ? event.slice(2) : event;
        element.addEventListener(domEvent, handler as EventListener);
      }
      onCleanup(() => {
        for (const [event, handler] of listeners) {
          const domEvent = event.startsWith("on") ? event.slice(2) : event;
          element.removeEventListener(domEvent, handler as EventListener);
        }
      });
    });
  };

  return {
    ref: sortable.ref,
    attach,
    attrs: {
      "aria-roledescription": "可拖拽排序项",
      tabindex: 0,
    },
    style: () => maybeTransformStyle(sortable.transform),
    isActive: () => sortable.isActiveDraggable,
  };
}
