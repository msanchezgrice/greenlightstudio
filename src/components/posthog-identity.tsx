"use client";

import { useUser } from "@clerk/nextjs";
import posthog from "posthog-js";
import { useEffect } from "react";

export function PostHogIdentity() {
  const { isLoaded, isSignedIn, user } = useUser();

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) return;

    posthog.identify(user.id);
    const marker = `posthog_signed_up:${user.id}`;
    const createdAt = user.createdAt?.getTime();
    if (
      createdAt &&
      Date.now() - createdAt < 15 * 60 * 1000 &&
      !window.localStorage.getItem(marker)
    ) {
      posthog.capture("signed_up", { source: "clerk_signup_completed" });
      window.localStorage.setItem(marker, "1");
    }
  }, [isLoaded, isSignedIn, user]);

  return null;
}
