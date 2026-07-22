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
  testId?: string;
  agentAction?: string;
};

export function TrackedLinkButton({
  href,
  className,
  eventName,
  eventProps,
  children,
  testId,
  agentAction,
}: TrackedLinkButtonProps) {
  return (
    <Link
      href={href}
      className={className}
      data-testid={testId}
      data-agent-action={agentAction}
      onClick={() => {
        track(eventName, eventProps);
      }}
    >
      {children}
    </Link>
  );
}
