import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  context: { params: Promise<{ fundId: string }> }
) {
  const { fundId } = await context.params;
  return NextResponse.json(
    {
      status: "TODO",
      endpoint: "GET /api/v1/funds/{fundId}/snapshots/latest",
      fundId: fundId,
      message: "Latest snapshot read model is not implemented yet."
    },
    { status: 501 }
  );
}
