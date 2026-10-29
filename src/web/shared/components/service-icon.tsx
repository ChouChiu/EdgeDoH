import { cn } from "@/shared/lib/utils";

/** A blocked service's registry SVG; the markup is untrusted, so it is only ever rendered as an image */
export function ServiceIcon({ icon, className }: { icon: string; className?: string }) {
  if (!icon) return <span className={cn("size-4 shrink-0 rounded-sm bg-muted", className)} />;
  return <img alt="" src={`data:image/svg+xml;utf8,${encodeURIComponent(icon)}`} className={cn("size-4 shrink-0", className)} />;
}
