import { beforeEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

// NOTE: These endpoints are implemented as Next.js route handlers. We test them
// by importing the handler functions directly and mocking the DB layer.

const usedNonces = new Set<string>();

vi.mock("@/lib/supabase", () => ({
  getFundByTelegramRoomId: vi.fn(),
  upsertFundBot: vi.fn(),
  upsertStakeWeight: vi.fn(),
  getBotsByBotId: vi.fn(),
  insertBotAuthNonce: vi.fn(async (botId: string, nonce: string) => {
    const key = `${botId}:${nonce}`;
    if (usedNonces.has(key)) return { ok: false, reason: "DUPLICATE" as const };
    usedNonces.add(key);
    return { ok: true as const };
  })
}));

import { GET as getRoomFund } from "@/app/api/v1/rooms/[roomId]/fund/route";
import { POST as postRoomJoin } from "@/app/api/v1/rooms/[roomId]/join/route";
import {
  getBotsByBotId,
  getFundByTelegramRoomId,
  upsertFundBot,
  upsertStakeWeight
} from "@/lib/supabase";

const mockGetFundByTelegramRoomId = vi.mocked(getFundByTelegramRoomId);
const mockUpsertFundBot = vi.mocked(upsertFundBot);
const mockUpsertStakeWeight = vi.mocked(upsertStakeWeight);
const mockGetBotsByBotId = vi.mocked(getBotsByBotId);

const FIXED_NOW_MS = 1_700_000_000_000;

describe("rooms endpoints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW_MS));
    usedNonces.clear();
    vi.clearAllMocks();
  });

  it("GET /rooms/{roomId}/fund returns 404 when fund not found", async () => {
    mockGetFundByTelegramRoomId.mockResolvedValueOnce(undefined);
    const response = await getRoomFund(
      new Request("http://localhost/api/v1/rooms/-100/fund"),
      { params: Promise.resolve({ roomId: "-100" }) }
    );
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe("NOT_FOUND");
  });

  it("GET /rooms/{roomId}/fund returns fund details when found", async () => {
    mockGetFundByTelegramRoomId.mockResolvedValueOnce({
      fund_id: "fund-1",
      fund_name: "Fund One",
      strategy_bot_id: "strategy-1",
      strategy_bot_address: "0x0000000000000000000000000000000000000001",
      verifier_threshold_weight: "1",
      intent_threshold_weight: "1",
      strategy_policy_uri: null,
      telegram_room_id: "-100",
      is_verified: true,
      visibility: "PUBLIC",
      verification_note: null,
      created_by: "system",
      created_at: FIXED_NOW_MS,
      updated_at: FIXED_NOW_MS,
      allowlist_tokens_json: "[]"
    });

    const response = await getRoomFund(
      new Request("http://localhost/api/v1/rooms/-100/fund"),
      { params: Promise.resolve({ roomId: "-100" }) }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("OK");
    expect(body.fundId).toBe("fund-1");
    expect(body.roomId).toBe("-100");
  });

  it("POST /rooms/{roomId}/join allows an unregistered bot (signature-only) to join", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000001"
    );

    mockGetBotsByBotId.mockResolvedValueOnce([]); // unregistered
    mockGetFundByTelegramRoomId.mockResolvedValueOnce({
      fund_id: "fund-join-1",
      fund_name: "Join Fund",
      strategy_bot_id: "strategy-1",
      strategy_bot_address: "0x0000000000000000000000000000000000000001",
      verifier_threshold_weight: "1",
      intent_threshold_weight: "1",
      strategy_policy_uri: null,
      telegram_room_id: "-100777",
      is_verified: true,
      visibility: "PUBLIC",
      verification_note: null,
      created_by: "system",
      created_at: FIXED_NOW_MS,
      updated_at: FIXED_NOW_MS,
      allowlist_tokens_json: "[]"
    });

    const botId = "participant-bot-1";
    const nonce = "nonce-1";
    const timestamp = String(Math.floor(FIXED_NOW_MS / 1000));
    const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
    const signature = await account.signMessage({ message });

    const request = new Request("http://localhost/api/v1/rooms/-100777/join", {
      method: "POST",
      headers: {
        "x-bot-id": botId,
        "x-bot-signature": signature,
        "x-bot-timestamp": timestamp,
        "x-bot-nonce": nonce
      }
    });

    const response = await postRoomJoin(request, {
      params: Promise.resolve({ roomId: "-100777" })
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("OK");
    expect(String(body.participantBotAddress).toLowerCase()).toBe(account.address.toLowerCase());

    expect(mockUpsertFundBot).toHaveBeenCalledWith(
      expect.objectContaining({
        fundId: "fund-join-1",
        botId,
        role: "participant",
        botAddress: account.address
      })
    );
    expect(mockUpsertStakeWeight).toHaveBeenCalledWith(
      expect.objectContaining({
        fundId: "fund-join-1",
        participant: account.address,
        weight: BigInt(1)
      })
    );
  });

  it("POST /rooms/{roomId}/join rejects replayed nonces", async () => {
    const account = privateKeyToAccount(
      "0x0000000000000000000000000000000000000000000000000000000000000002"
    );
    mockGetBotsByBotId.mockResolvedValue([]); // unregistered
    mockGetFundByTelegramRoomId.mockResolvedValue({
      fund_id: "fund-join-2",
      fund_name: "Join Fund 2",
      strategy_bot_id: "strategy-1",
      strategy_bot_address: "0x0000000000000000000000000000000000000001",
      verifier_threshold_weight: "1",
      intent_threshold_weight: "1",
      strategy_policy_uri: null,
      telegram_room_id: "-100888",
      is_verified: true,
      visibility: "PUBLIC",
      verification_note: null,
      created_by: "system",
      created_at: FIXED_NOW_MS,
      updated_at: FIXED_NOW_MS,
      allowlist_tokens_json: "[]"
    });

    const botId = "participant-bot-2";
    const nonce = "nonce-replay";
    const timestamp = String(Math.floor(FIXED_NOW_MS / 1000));
    const message = `openfunderse:auth:${botId}:${timestamp}:${nonce}`;
    const signature = await account.signMessage({ message });

    const mkReq = () =>
      new Request("http://localhost/api/v1/rooms/-100888/join", {
        method: "POST",
        headers: {
          "x-bot-id": botId,
          "x-bot-signature": signature,
          "x-bot-timestamp": timestamp,
          "x-bot-nonce": nonce
        }
      });

    const first = await postRoomJoin(mkReq(), { params: Promise.resolve({ roomId: "-100888" }) });
    expect(first.status).toBe(200);

    const second = await postRoomJoin(mkReq(), { params: Promise.resolve({ roomId: "-100888" }) });
    expect(second.status).toBe(401);
    const body = await second.json();
    expect(body.error).toBe("UNAUTHORIZED");
  });
});

