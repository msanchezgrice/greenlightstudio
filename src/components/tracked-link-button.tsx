"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { track } from "@vercel/analytics";

type TrackedLinkButtonProps = {
  href: string;
  className?: string;
  eventName: string;
  eventProps?: Record<string, string | number | boolean>;
  children: ReactNode;
};

export function TrackedLinkButton({
  href,
  className,
  eventName,
  eventProps,
  children,
}: TrackedLinkButtonProps) {
  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        track(eventName, eventProps);
      }}
    >
      {children}
    </Link>
  );
}
