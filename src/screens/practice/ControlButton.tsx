import type { ButtonHTMLAttributes } from "react";

/**
 * A button that does not take keyboard focus when clicked, so Space and Enter
 * keep working as practice shortcuts afterwards.
 */
export default function ControlButton(props: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} onMouseDown={(event) => event.preventDefault()} />;
}
