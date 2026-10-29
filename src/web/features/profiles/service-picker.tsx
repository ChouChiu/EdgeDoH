import { useMemo, useState } from "react";
import { Search } from "@/shared/components/animate-ui/icons/search";
import { QueryError } from "@/shared/components/page";
import { ServiceIcon } from "@/shared/components/service-icon";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { useI18n } from "@/shared/i18n";
import { cn } from "@/shared/lib/utils";
import { type Service, useServices } from "./api";

/** Toggle grid of blocked services, grouped by category */
export function ServicePicker({ id, value, onChange }: { id: string; value: string[]; onChange: (next: string[]) => void }) {
  const { t } = useI18n();
  const services = useServices();
  const [search, setSearch] = useState("");
  const selected = new Set(value);

  const groups = useMemo(() => {
    const term = search.trim().toLowerCase();
    const byGroup = new Map<string, Service[]>();
    for (const s of services.data ?? []) {
      if (term && !s.name.toLowerCase().includes(term) && !s.id.includes(term)) continue;
      byGroup.set(s.group, [...(byGroup.get(s.group) ?? []), s]);
    }
    // "other" holds most community services, so it goes after the named groups
    return [...byGroup].sort(([a], [b]) => Number(a === "other") - Number(b === "other") || a.localeCompare(b));
  }, [services.data, search]);

  if (services.error) return <QueryError error={services.error} />;
  if (!services.data) return <Skeleton className="h-40 w-full" />;

  const toggle = (sid: string) => onChange(selected.has(sid) ? value.filter((v) => v !== sid) : [...value, sid]);

  return (
    <div className="space-y-3 py-3">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} className="pl-8" placeholder={t("profiles.searchServices")} value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {groups.map(([group, items]) => (
        <fieldset key={group} className="space-y-1.5">
          <legend className="text-xs font-medium text-muted-foreground">{groupLabel(group, t)}</legend>
          <div className="flex flex-wrap gap-1.5">
            {items.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={selected.has(s.id)}
                onClick={() => toggle(s.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                  selected.has(s.id) ? "border-destructive/50 bg-destructive/10 text-destructive" : "hover:bg-accent",
                )}
              >
                <ServiceIcon icon={s.icon} name={s.name} />
                {s.name}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

const GROUPS = ["ai", "cdn", "dating", "gambling", "gaming", "hosting", "messenger", "other", "privacy", "shopping", "social_network", "software", "streaming"] as const;

function groupLabel(group: string, t: ReturnType<typeof useI18n>["t"]): string {
  return (GROUPS as readonly string[]).includes(group) ? t(`services.group.${group as (typeof GROUPS)[number]}`) : group;
}
