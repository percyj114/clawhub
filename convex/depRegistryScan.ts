import { v } from "convex/values";
import { internalAction } from "./functions";

/**
 * Compatibility shim for scheduler rows created before dependency registry scans
 * were retired. New publish flows no longer schedule this action.
 */
export const checkDependencyRegistries = internalAction({
  args: { versionId: v.id("skillVersions") },
  handler: async () => null,
});
