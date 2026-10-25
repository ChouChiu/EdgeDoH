/**
 * Mirrors the visual viewport into CSS variables so fixed and sticky UI can avoid the on-screen keyboard:
 *
 *   --vv-top          offset of the visible area from the layout viewport's top
 *   --vv-height       height of the visible area
 *   --keyboard-inset  layout viewport height hidden below the visible area, i.e. the keyboard
 *
 * Chromium with `interactive-widget=resizes-content` already shrinks the layout viewport, so the inset stays 0
 * there; iOS Safari keeps the layout viewport and only shrinks the visual one, which is what the inset covers
 */
export function trackVisualViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement.style;
  let previousHeight = vv.height;

  const update = () => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    root.setProperty("--vv-top", `${vv.offsetTop}px`);
    root.setProperty("--vv-height", `${vv.height}px`);
    root.setProperty("--keyboard-inset", `${inset}px`);
    // When the keyboard opens, keep the field being typed into visible above it
    if (vv.height < previousHeight) {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches("input, textarea, [contenteditable='true']")) {
        active.scrollIntoView({ block: "nearest" });
      }
    }
    previousHeight = vv.height;
  };

  update();
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
}
