import { useTheme } from "@/shared/components/theme-provider"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheck } from "@/shared/components/animate-ui/icons/circle-check"
import { Info } from "@/shared/components/animate-ui/icons/info"
import { LoaderCircle } from "@/shared/components/animate-ui/icons/loader-circle"
import { OctagonAlert } from "@/shared/components/animate-ui/icons/octagon-alert"
import { TriangleAlert } from "@/shared/components/animate-ui/icons/triangle-alert"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheck animate className="size-4" />
        ),
        info: (
          <Info animate className="size-4" />
        ),
        warning: (
          <TriangleAlert animate className="size-4" />
        ),
        error: (
          <OctagonAlert animate className="size-4" />
        ),
        loading: (
          <LoaderCircle animate className="size-4" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
