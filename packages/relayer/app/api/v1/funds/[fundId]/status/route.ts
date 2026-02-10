import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "GET /api/v1/funds/{fundId}/status",
      fundId: fundId,
      message:
        "Fund status baseline is scaffolded. Implement epoch progress, claim/intent approval status, and last execution summary."
    },
    { status: 501 }
  );
}
