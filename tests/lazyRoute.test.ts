import { describe, expect, it, vi } from "vitest";
import { loadRouteModule } from "@/services/lazyRoute";

describe("lazy route loading", () => {
  it("retries one transient chunk failure and resolves the module", async () => {
    const loader = vi
      .fn<() => Promise<{ default: () => null }>>()
      .mockRejectedValueOnce(new Error("transient chunk failure"))
      .mockResolvedValueOnce({ default: () => null });

    const result = await loadRouteModule(loader, 1, 0);

    expect(result.default).toBeTypeOf("function");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("keeps a permanent chunk failure bounded", async () => {
    const error = new Error("permanent chunk failure");
    const loader = vi.fn<() => Promise<{ default: () => null }>>().mockRejectedValue(error);

    await expect(loadRouteModule(loader, 1, 0)).rejects.toBe(error);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
