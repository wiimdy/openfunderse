import { NextResponse } from 'next/server';
import { getFundBot } from '@/lib/supabase';

export interface FundBotAuthzInput {
  fundId: string;
  botId: string;
  allowedRoles: string[];
  requireActive?: boolean;
}

export interface FundBotMembership {
  fundId: string;
  botId: string;
  role: string;
  botAddress: string;
  status: string;
}

export type FundBotAuthzResult =
  | {
      ok: true;
      membership: FundBotMembership;
    }
  | {
      ok: false;
      response: NextResponse;
    };

const normalizeRole = (role: string): string => role.trim().toLowerCase();

const normalizeAddress = (value: string): string => value.trim().toLowerCase();

export const isSameAddress = (left: string, right: string): boolean => {
  return normalizeAddress(left) === normalizeAddress(right);
};

export const requireFundBotRole = async (
  input: FundBotAuthzInput
): Promise<FundBotAuthzResult> => {
  const membership = await getFundBot(input.fundId, input.botId);
  if (!membership) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'bot is not registered to this fund',
          fundId: input.fundId,
          botId: input.botId
        },
        { status: 403 }
      )
    };
  }

  if ((input.requireActive ?? true) && membership.status.toUpperCase() !== 'ACTIVE') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'bot membership is not active',
          fundId: input.fundId,
          botId: input.botId,
          status: membership.status
        },
        { status: 403 }
      )
    };
  }

  const role = normalizeRole(membership.role);
  const allowedRoles = new Set(input.allowedRoles.map((entry) => normalizeRole(entry)));
  if (!allowedRoles.has(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: 'FORBIDDEN',
          message: 'bot role is not allowed for this endpoint',
          fundId: input.fundId,
          botId: input.botId,
          role: membership.role,
          allowedRoles: Array.from(allowedRoles)
        },
        { status: 403 }
      )
    };
  }

  return {
    ok: true,
    membership: {
      fundId: membership.fund_id,
      botId: membership.bot_id,
      role: membership.role,
      botAddress: membership.bot_address,
      status: membership.status
    }
  };
};
