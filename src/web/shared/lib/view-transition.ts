/**
 * Runs a theme change inside a View Transition when the browser supports one and motion is allowed.
 * `expand` grows the new theme out of `origin`, `collapse` shrinks the old one back into it.
 * <html data-transition> carries the direction for the duration, so the CSS applies to nothing else
 */
export function withThemeTransition(direction: "expand" | "collapse", update: () => void, origin: { x: number; y: number }): void {
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    update();
    return;
  }
  const root = document.documentElement;
  // The reveal circle has to reach the farthest corner from where it starts
  const radius = Math.hypot(Math.max(origin.x, innerWidth - origin.x), Math.max(origin.y, innerHeight - origin.y));
  root.style.setProperty("--transition-x", `${origin.x}px`);
  root.style.setProperty("--transition-y", `${origin.y}px`);
  root.style.setProperty("--transition-r", `${radius}px`);
  root.dataset.transition = direction;
  const transition = document.startViewTransition(update);
  // A skipped transition (another one started, tab hidden) still applies the update; only the animation is lost
  transition.ready.catch(() => {});
  void transition.finished.finally(() => {
    delete root.dataset.transition;
  });
}

/** Centre of the element that triggered a change, for a reveal that starts under the pointer or focused control */
export function originOf(element: Element): { x: number; y: number } {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}
