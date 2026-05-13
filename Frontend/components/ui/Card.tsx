import * as React from "react";
import { cn } from "@/lib/utils/cn";

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  raised?: boolean;
  inset?: boolean;
};

export function Card({ className, raised, inset, ...rest }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-raised",
        raised ? "shadow-elevated" : "shadow-card",
        inset && "bg-surface-sunken",
        className,
      )}
      {...rest}
    />
  );
}

export function CardHeader({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 border-b border-line-subtle px-6 pb-4 pt-5",
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({
  className,
  ...rest
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn(
        "text-[15px] font-semibold tracking-[-0.005em] text-ink",
        className,
      )}
      {...rest}
    />
  );
}

export function CardDescription({
  className,
  ...rest
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-ink-muted text-pretty", className)} {...rest} />
  );
}

export function CardBody({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-6 py-5", className)} {...rest} />;
}

export function CardFooter({
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 border-t border-line-subtle bg-surface-sunken/60 px-6 py-3.5",
        className,
      )}
      {...rest}
    />
  );
}
