import { cn } from "@/shared/lib/utils";

/**
 * A blocked service's registry SVG. The markup is untrusted, so it is never inlined: it is used as a
 * CSS mask over the text colour instead. Registry icons draw with `currentColor`, which an `<img>`
 * resolves to black; as a mask they follow the theme like every other icon
 */
export function ServiceIcon({ icon, name, className }: { icon: string; name: string; className?: string }) {
  // Community services have no icon: their first character stands in
  if (!icon) {
    return (
      <span aria-hidden className={cn("flex size-4 shrink-0 items-center justify-center rounded-sm bg-muted text-[10px] leading-none font-medium", className)}>
        {[...name][0]}
      </span>
    );
  }
  const url = `url("data:image/svg+xml;utf8,${encodeURIComponent(icon)}")`;
  return (
    <span
      aria-hidden
      className={cn("size-4 shrink-0 bg-current", className)}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: "contain", maskRepeat: "no-repeat", maskPosition: "center" }}
    />
  );
}
