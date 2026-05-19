import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { changePassword } from "@/lib/auth"

export async function POST(request: NextRequest) {
  const session = await auth()
  
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 })
  }
  
  try {
    const body = await request.json()
    const { oldPassword, newPassword } = body
    
    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: "请填写完整" }, { status: 400 })
    }
    
    const success = changePassword(oldPassword, newPassword)
    
    if (!success) {
      return NextResponse.json({ error: "原密码错误" }, { status: 400 })
    }
    
    return NextResponse.json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : "修改失败"
    return NextResponse.json({ error: message }, { status: 400 })
  }
}