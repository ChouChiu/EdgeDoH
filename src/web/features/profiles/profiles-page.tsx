import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { useDevices } from "@/features/devices/api";
import { ChevronRight } from "@/shared/components/animate-ui/icons/chevron-right";
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle";
import { Plus } from "@/shared/components/animate-ui/icons/plus";
import { PageHeader, QueryError } from "@/shared/components/page";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Label } from "@/shared/ui/label";
import { Skeleton } from "@/shared/ui/skeleton";
import { type Translate, useI18n } from "@/shared/i18n";
import { errorMessage } from "@/shared/lib/http";
import { DEFAULT_PROFILE_ID, MAX_PROFILE_NAME, type Profile, PROFILES_KEY, profileName, profilesApi, useProfiles } from "./api";

export function ProfilesPage() {
  const { t } = useI18n();
  const profiles = useProfiles();
  const devices = useDevices();
  const count = (id: string) => devices.data?.filter((d) => (d.profileId ?? DEFAULT_PROFILE_ID) === id).length ?? 0;
  return (
    <>
      <PageHeader title={t("nav.profiles")} actions={<NewProfileDialog />} />
      {profiles.error && <QueryError error={profiles.error} />}
      {profiles.isPending && <Skeleton className="h-32 w-full" />}
      <div className="grid gap-2">
        {profiles.data?.map((p) => (
          <Card key={p.id} size="sm" className="transition-colors hover:bg-accent/40">
            <Link to={`/profiles/${p.id}`} className="contents">
              <CardHeader>
                <CardTitle>{profileName(p, t)}</CardTitle>
                <CardDescription>{t("profiles.devices", { count: count(p.id) })}</CardDescription>
                <CardAction>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </CardAction>
                <div className="col-span-full flex flex-wrap gap-1 pt-1">
                  {summary(p, t).map((label) => (
                    <Badge key={label} variant="secondary">
                      {label}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
            </Link>
          </Card>
        ))}
      </div>
    </>
  );
}

/** The features a profile turns on, as short badges */
function summary(p: Profile, t: Translate): string[] {
  if (!p.filtering) return [t("profiles.filteringOff")];
  const out: string[] = [];
  if (p.lists !== null) out.push(t("profiles.listsCount", { count: p.lists.length }));
  if (p.services.length > 0) out.push(t("profiles.servicesCount", { count: p.services.length }));
  if (p.schedule && p.scheduledServices.length > 0) out.push(t("profiles.schedule"));
  if (p.safeSearch) out.push(t("profiles.safeSearch"));
  if (p.youtubeRestricted) out.push(t("profiles.youtube"));
  if (p.rebinding) out.push(t("profiles.rebinding"));
  if (p.upstreams) out.push(t("profiles.customUpstreams"));
  if (p.ecs) out.push("ECS");
  if (p.ech) out.push("ECH");
  if (p.h3) out.push("HTTP/3");
  return out;
}

function NewProfileDialog() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => profilesApi.create(name.trim()),
    onSuccess: async (profile) => {
      await queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
      setOpen(false);
      setName("");
      void navigate(`/profiles/${profile.id}`);
    },
    onError: (err) => toast.error(t("common.saveFailed"), { description: errorMessage(err, t) }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          {t("profiles.add")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{t("profiles.add")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t("common.name")}</Label>
            <Input
              id="profile-name"
              required
              autoFocus
              maxLength={MAX_PROFILE_NAME}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("profiles.namePlaceholder")}
              enterKeyHint="done"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending || !name.trim()}>
              {create.isPending && <LoaderCircle animate />}
              {t("common.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
