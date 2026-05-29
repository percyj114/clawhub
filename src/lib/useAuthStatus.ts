import { useConvexAuth, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Doc } from "../../convex/_generated/dataModel";
import { getRuntimeEnv } from "./runtimeEnv";

export function useAuthStatus() {
  const auth = useConvexAuth();
  const shouldLoadUser =
    !auth.isLoading && (auth.isAuthenticated || getRuntimeEnv("VITE_ENABLE_DEV_AUTH") === "1");
  const userResult = useQuery(api.users.me, shouldLoadUser ? {} : "skip") as
    | Doc<"users">
    | null
    | undefined;
  const isUserLoading = shouldLoadUser && userResult === undefined;
  const me = shouldLoadUser ? userResult : auth.isLoading ? undefined : null;
  const hasResolvedUser = Boolean(me);

  return {
    me,
    isLoading: auth.isLoading || isUserLoading,
    isAuthenticated: auth.isAuthenticated || hasResolvedUser,
  };
}
