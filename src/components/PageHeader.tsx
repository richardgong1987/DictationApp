import { useEffect, useRef, type ReactNode } from "react";

/**
 * The top of a screen, which stays at the top of the window while the page
 * scrolls. Its height is kept in --page-header-height, so that a card
 * scrolled into view, or a focused field, ends up below the header rather
 * than under it.
 */
export default function PageHeader({ children }: { children: ReactNode }) {
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() =>
      root.style.setProperty("--page-header-height", `${header.offsetHeight}px`),
    );
    observer.observe(header, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty("--page-header-height");
    };
  }, []);

  return (
    <header ref={headerRef} className="page-header">
      {children}
    </header>
  );
}
