import { describe, expect, it } from "vitest";
import { checkDependencyRegistries } from "./depRegistryScan";

type WrappedHandler<TArgs, TResult = unknown> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const checkDependencyRegistriesHandler = (
  checkDependencyRegistries as unknown as WrappedHandler<{ versionId: string }, null>
)._handler;

describe("checkDependencyRegistries", () => {
  it("keeps old scheduled dependency registry scan rows as a no-op", async () => {
    await expect(
      checkDependencyRegistriesHandler({}, { versionId: "skillVersions:legacy" }),
    ).resolves.toBeNull();
  });
});
