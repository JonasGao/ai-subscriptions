import { Subscription } from "./types";

export function stripCredentials(sub: Subscription) {
  const { credentials, ...rest } = sub;
  return { ...rest, hasCredentials: !!credentials };
}
