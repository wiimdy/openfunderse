import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

vi.mock("@/lib/supabase", () => ({
  getBotsByBotId: vi.fn(),
  insertBotAuthNonce: vi.fn(async () => ({ ok: true as const }))
}));

import { requireBotAuth } from "@/lib/bot-auth";
import { getBotsByBotId } from "@/lib/supabase";

const mockGetBotsByBotId = vi.mocked(getBotsByBotId);

const FIXED_NOW_MS = 1_700_000_000_000;

describe("requireBotAuth", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW_MS));
    vi.clearAllMocks();
  });

  it("allows signature-only auth when requiredScopes is empty", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000003"
    );
    const botId = "bot-auth-1";
    const nonce = "nonce-1";
    const timestamp = String(Math.floor(FIXED_NOW_MS / 1000));
    const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
    const signature = await account.signMessage({ message });

    mockGetBotsByBotId.mockResolvedValueOnce([]); // unregistered

    const request = new Request("http://localhost", {
      headers: {
        "x-bot-id": botId,
        "x-bot-signature": signature,
        "x-bot-timestamp": timestamp,
        "x-bot-nonce": nonce
      }
    });

    const out = await requireBotAuth(request, []);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.botId).toBe(botId);
      expect(out.botAddress.toLowerCase()).toBe(account.address.toLowerCase());
    }
  });

  it("rejects unregistered bots when requiredScopes are present", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000004"
    );
    const botId = "bot-auth-2";
    const nonce = "nonce-2";
    const timestamp = String(Math.floor(FIXED_NOW_MS / 1000));
    const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
    const signature = await account.signMessage({ message });

    mockGetBotsByBotId.mockResolvedValueOnce([]); // unregistered

    const request = new Request("http://localhost", {
      headers: {
        "x-bot-id": botId,
        "x-bot-signature": signature,
        "x-bot-timestamp": timestamp,
        "x-bot-nonce": nonce
      }
    });

    const out = await requireBotAuth(request, ["claims.submit"]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.response.status).toBe(401);
      const body = await out.response.json();
      expect(body.error).toBe("UNAUTHORIZED");
    }
  });
});

