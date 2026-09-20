"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg whitespace-pre-line",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          warning:
            "group-[.toast]:bg-amber-50 group-[.toast]:text-amber-900 group-[.toaster]:border-amber-200 dark:group-[.toast]:bg-amber-950 dark:group-[.toast]:text-amber-100 dark:group-[.toaster]:border-amber-800",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
