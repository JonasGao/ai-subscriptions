import { NextRequest, NextResponse } from "next/server";
import { deleteProxyTag, renameProxyTag } from "@/lib/proxy-subscriptions";

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const tag = renameProxyTag(params.id, body.name);
    if (!tag)
      return NextResponse.json({ error: "标签不存在" }, { status: 404 });
    return NextResponse.json(tag);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "重命名标签失败" },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  const result = deleteProxyTag(params.id);
  if (!result)
    return NextResponse.json({ error: "标签不存在" }, { status: 404 });
  return NextResponse.json(result);
}
