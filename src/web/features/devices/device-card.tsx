import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";
import { ConfirmDialog } from "@/shared/components/confirm-dialog";
import { Copy } from "@/shared/components/animate-ui/icons/copy";
import { Download } from "@/shared/components/animate-ui/icons/download";
import { Network } from "@/shared/components/animate-ui/icons/network";
import { Pause } from "@/shared/components/animate-ui/icons/pause";
import { Play } from "@/shared/components/animate-ui/icons/play";
import { ScrollText } from "@/shared/components/animate-ui/icons/scroll-text";
import { Trash2 } from "@/shared/components/animate-ui/icons/trash-2";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { DEFAULT_PROFILE_ID, profileName, useProfiles } from "@/features/profiles/api";
import { useSettings } from "@/features/settings/api";
import { useI18n } from "@/shared/i18n";
import { copyText } from "@/shared/lib/clipboard";
import { errorMessage } from "@/shared/lib/http";
import { DEVICES_KEY, type Device, devicesApi } from "./api";
import { DeviceNameDialog } from "./device-name-dialog";

export function DeviceCard({ device }: { device: Device }) {
  const { t, fmt } = useI18n();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => devicesApi.remove(device.id),
    onSuccess: () => {
      toast.success(t("devices.deleted", { name: device.name }));
      return queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    },
    onError: (err) => toast.error(t("devices.deleteFailed"), { description: errorMessage(err, t) }),
  });

  return (
    <Card size="sm" className={remove.isPending ? "opacity-50" : undefined}>
      <CardHeader>
        <CardTitle>{device.name}</CardTitle>
        <CardDescription>
          {device.pausedUntil ? (
            <span className="text-warning">{t("devices.pausedUntil", { time: fmt.time(device.pausedUntil) })}</span>
          ) : (
            t("devices.added", { time: fmt.relative(device.createdAt) })
          )}
        </CardDescription>
        <CardAction className="flex gap-1">
          <DeviceNameDialog device={device} />
          <ConfirmDialog
            title={t("devices.deleteTitle", { name: device.name })}
            description={t("devices.deleteBody")}
            confirmLabel={t("common.delete")}
            onConfirm={() => remove.mutate()}
          >
            <Button variant="ghost" size="icon-sm" aria-label={t("common.delete")} title={t("common.delete")} disabled={remove.isPending}>
              <Trash2 />
            </Button>
          </ConfirmDialog>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex gap-2">
          <Input readOnly value={device.dohUrl} aria-label="DoH URL" className="font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button
            variant="outline"
            size="icon"
            onClick={() => void copyText(device.dohUrl, t, t("devices.urlCopied"))}
            aria-label={t("common.copy")}
            title={t("common.copy")}
          >
            <Copy />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProfileSelect device={device} />
          <PauseButton device={device} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={devicesApi.mobileconfigUrl(device.id)} download>
              <Download />
              {t("devices.downloadProfile")}
            </a>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/logs?device=${device.id}`}>
              <ScrollText />
              {t("devices.viewLogs")}
            </Link>
          </Button>
          <ClientsButton device={device} />
        </div>
      </CardContent>
    </Card>
  );
}

function ProfileSelect({ device }: { device: Device }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const profiles = useProfiles();
  const assign = useMutation({
    mutationFn: (id: string) => devicesApi.setProfile(device.id, id === DEFAULT_PROFILE_ID ? null : id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: DEVICES_KEY }),
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });
  return (
    <Select value={device.profileId ?? DEFAULT_PROFILE_ID} onValueChange={(v) => assign.mutate(v)} disabled={assign.isPending || !profiles.data}>
      <SelectTrigger size="sm" className="min-w-36" aria-label={t("devices.profile")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {profiles.data?.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {profileName(p, t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const PAUSE_MINUTES = [5, 30, 60, 240] as const;

function PauseButton({ device }: { device: Device }) {
  const { t, fmt } = useI18n();
  const queryClient = useQueryClient();
  const pause = useMutation({
    mutationFn: (minutes: number) => devicesApi.pause(device.id, minutes),
    onSuccess: (updated) => {
      toast.success(updated.pausedUntil ? t("devices.paused", { time: fmt.time(updated.pausedUntil) }) : t("devices.resumed"), {
        description: t("settings.savedDetail"),
      });
      return queryClient.invalidateQueries({ queryKey: DEVICES_KEY });
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });
  if (device.pausedUntil) {
    return (
      <Button variant="outline" size="sm" disabled={pause.isPending} onClick={() => pause.mutate(0)}>
        <Play />
        {t("devices.resume")}
      </Button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" disabled={pause.isPending}>
          <Pause />
          {t("devices.pause")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PAUSE_MINUTES.map((m) => (
          <DropdownMenuItem key={m} onSelect={() => pause.mutate(m)}>
            {m < 60 ? t("devices.pauseMinutes", { count: m }) : t("devices.pauseHours", { count: m / 60 })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Only shown while the client limit is on; reading the list wakes the device's Durable Object */
function ClientsButton({ device }: { device: Device }) {
  const { t, fmt } = useI18n();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const enabled = (settings.data?.maxDeviceClients ?? 0) > 0;
  const key = [...DEVICES_KEY, device.id, "clients"];
  const clients = useQuery({ queryKey: key, queryFn: () => devicesApi.clients(device.id), enabled });
  const reset = useMutation({
    mutationFn: () => devicesApi.resetClients(device.id),
    onSuccess: () => {
      toast.success(t("devices.clientsResetDone"));
      return queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });
  if (!enabled || !clients.data) return null;
  const { limit, windowMinutes, clients: seen } = clients.data;
  const full = seen.length >= limit;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={full ? "ml-auto text-destructive" : "ml-auto text-muted-foreground"}>
          <Network />
          {t("devices.clientsLimit", { count: seen.length, limit })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-2 text-sm">
        <p className="font-medium">{t("devices.clientsTitle", { minutes: windowMinutes })}</p>
        {seen.length === 0 ? (
          <p className="text-muted-foreground">{t("devices.clientsEmpty")}</p>
        ) : (
          <ul className="space-y-1">
            {seen.map((c) => (
              <li key={c.client} className="flex justify-between gap-2 text-xs">
                <code className="truncate">{c.client}</code>
                <span className="shrink-0 text-muted-foreground">{fmt.relative(c.lastSeen)}</span>
              </li>
            ))}
          </ul>
        )}
        <Button size="sm" variant="outline" className="w-full" disabled={reset.isPending || seen.length === 0} onClick={() => reset.mutate()}>
          {t("devices.clientsReset")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
