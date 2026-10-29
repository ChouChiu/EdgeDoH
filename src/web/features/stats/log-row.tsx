import { ActionBadge } from "@/shared/components/action-badge";
import { Ban } from "@/shared/components/animate-ui/icons/ban";
import { Check } from "@/shared/components/animate-ui/icons/check";
import { Copy } from "@/shared/components/animate-ui/icons/copy";
import { Ellipsis } from "@/shared/components/animate-ui/icons/ellipsis";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { TableCell, TableRow } from "@/shared/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { useListName } from "@/features/filters/api";
import { useServices } from "@/features/profiles/api";
import { ServiceIcon } from "@/shared/components/service-icon";
import { useI18n } from "@/shared/i18n";
import { copyText } from "@/shared/lib/clipboard";
import type { LogEntry } from "./api";

export type RuleKind = "block" | "allow";

export function ruleFor(name: string, kind: RuleKind): string {
  return kind === "allow" ? `@@||${name}^` : `||${name}^`;
}

interface LogRowProps {
  entry: LogEntry;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onRule: (kind: RuleKind, names: string[]) => void;
}

export function LogRow({ entry, selected, onSelect, onRule }: LogRowProps) {
  const { t, fmt } = useI18n();
  const listName = useListName();
  const services = useServices();
  const service = entry.service ? services.data?.find((s) => s.id === entry.service) : undefined;
  const origin = [entry.client, entry.network].filter(Boolean).join(" · ");
  const details = [entry.type, entry.rcode !== "NOERROR" && entry.rcode, entry.source !== "upstream" && t(`logs.source.${entry.source}`)].filter(Boolean);
  return (
    <TableRow data-state={selected ? "selected" : undefined}>
      <TableCell className="w-8 pr-0">
        <Checkbox checked={selected} onCheckedChange={(v) => onSelect(v === true)} aria-label={`${t("common.select")} ${entry.name}`} />
      </TableCell>
      <TableCell className="text-xs tabular-nums text-muted-foreground">{fmt.dateTime(entry.time)}</TableCell>
      <TableCell className="max-w-64">
        <div className="truncate font-medium" title={entry.name}>
          {entry.name}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {details.join(" · ")}
          <span className="md:hidden"> · {entry.deviceName}</span>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex items-center gap-1.5">
          {entry.deviceName}
          {entry.service && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {service && <ServiceIcon icon={service.icon} name={service.name} className="size-3.5" />}
                  {service?.name ?? entry.service}
                </span>
              </TooltipTrigger>
              <TooltipContent>{t("logs.serviceHint")}</TooltipContent>
            </Tooltip>
          )}
        </div>
        {origin && (
          <div className="truncate text-xs text-muted-foreground" title={origin}>
            {origin}
          </div>
        )}
      </TableCell>
      <TableCell>
        <ActionBadge action={entry.action} />
      </TableCell>
      <TableCell className="hidden max-w-56 lg:table-cell">
        {entry.rule && (
          <Tooltip>
            <TooltipTrigger asChild>
              <code className="block truncate text-xs">{entry.rule.text}</code>
            </TooltipTrigger>
            <TooltipContent>{t("logs.ruleSource", { list: listName(entry.rule.listId), line: entry.rule.line })}</TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className="hidden text-right text-xs tabular-nums text-muted-foreground sm:table-cell">{Math.round(entry.latencyMs)} ms</TableCell>
      <TableCell className="w-10">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("common.actions")}>
              <Ellipsis />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {entry.action === "block" ? (
              <DropdownMenuItem onClick={() => onRule("allow", [entry.name])}>
                <Check />
                {t("logs.allow")}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={() => onRule("block", [entry.name])}>
                <Ban />
                {t("logs.block")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => void copyText(entry.name, t)}>
              <Copy />
              {t("logs.copyName")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );
}
