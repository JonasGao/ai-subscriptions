import type { Component } from "solid-js";

/** Hand-authored inline SVG icons, one stroke/weight family, no icon library. */

export const CloseIcon: Component<{ size?: number }> = (props) => {
  const size = props.size ?? 12;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M2 2l8 8M10 2l-8 8" />
    </svg>
  );
};

export const DragIcon: Component<{ size?: number }> = (props) => {
  const size = props.size ?? 12;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="3" cy="2.5" r="1.3" />
      <circle cx="9" cy="2.5" r="1.3" />
      <circle cx="3" cy="6" r="1.3" />
      <circle cx="9" cy="6" r="1.3" />
      <circle cx="3" cy="9.5" r="1.3" />
      <circle cx="9" cy="9.5" r="1.3" />
    </svg>
  );
};
