import { describe, expect, it, vi } from "vitest";
import { retryTelegramRateLimit } from "../src/sink";

describe("Telegram rate limits", () => {
  it("waits for Telegram's retry-after and retries a rejected delivery", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 3 } })
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    await retryTelegramRateLimit(send, wait);
    expect(wait).toHaveBeenCalledWith(3000);
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("bounds retries and refuses excessively long rate-limit waits", async () => {
    const wait = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockRejectedValue({ error_code: 429, parameters: { retry_after: 1 } });
    await expect(retryTelegramRateLimit(send, wait)).rejects.toMatchObject({ error_code: 429 });
    expect(send).toHaveBeenCalledTimes(3);
    wait.mockClear();
    await expect(
      retryTelegramRateLimit(async () => {
        throw { error_code: 429, parameters: { retry_after: 120 } };
      }, wait),
    ).rejects.toMatchObject({ error_code: 429 });
    expect(wait).not.toHaveBeenCalled();
  });
  it("does not replay an ambiguous network error or a blocked-bot rejection", async () => {
    for (const error of [new Error("Connection lost"), { error_code: 403 }]) {
      const send = vi.fn().mockRejectedValue(error);
      await expect(retryTelegramRateLimit(send)).rejects.toBe(error);
      expect(send).toHaveBeenCalledTimes(1);
    }
  });
});
