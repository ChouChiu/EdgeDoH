import { AnimateIcon } from "@animate-ui/react/icons";
import { cn } from "cn";
import type { KeyboardEvent } from "react";
import { Check } from "@/shared/components/animate-ui/icons/check";
import { Languages } from "@/shared/components/animate-ui/icons/languages";
import { Monitor } from "@/shared/components/animate-ui/icons/monitor";
import { Moon } from "@/shared/components/animate-ui/icons/moon";
import { Sun } from "@/shared/components/animate-ui/icons/sun";
import { type Theme, useTheme } from "@/shared/components/theme-provider";
import { Button } from "@/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { LOCALE_NAMES, LOCALES, useI18n } from "@/shared/i18n";
import { originOf } from "@/shared/lib/view-transition";

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

/** Light / dark / system as one segmented control; arrow keys move between the options like a radio group */
export function ThemeSwitch({ className }: { className?: string }) {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const options = Object.keys(THEME_ICONS) as Theme[];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const next = options[(options.indexOf(theme) + step + options.length) % options.length]!;
    const button = event.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-option="${next}"]`);
    button?.focus();
    setTheme(next, button ? originOf(button) : undefined);
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("theme.toggle")}
      onKeyDown={onKeyDown}
      className={cn("inline-flex items-center gap-0.5 rounded-lg border bg-muted/60 p-0.5", className)}
    >
      {options.map((option) => {
        const Icon = THEME_ICONS[option];
        const checked = option === theme;
        return (
          <AnimateIcon key={option} asChild animateOnHover>
            <button
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={t(`theme.${option}`)}
              title={t(`theme.${option}`)}
              tabIndex={checked ? 0 : -1}
              data-theme-option={option}
              onClick={(event) => setTheme(option, originOf(event.currentTarget))}
              className={cn(
                "flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:size-8 [&_svg]:size-3.5",
                checked && "bg-background text-foreground shadow-sm dark:bg-input/60",
              )}
            >
              <Icon />
            </button>
          </AnimateIcon>
        );
      })}
    </div>
  );
}

export function LocaleToggle() {
  const { t, locale, setLocale } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t("locale.toggle")} title={t("locale.toggle")}>
          <Languages />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((option) => (
          <DropdownMenuItem key={option} lang={option} onClick={() => setLocale(option)}>
            {LOCALE_NAMES[option]}
            {option === locale && <Check className="ml-auto" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
