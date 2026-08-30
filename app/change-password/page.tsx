"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, ArrowLeft } from "lucide-react";

function ChangePasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isForced = searchParams.get("force") === "1";

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (newPassword !== confirmPassword) {
      setError("两次输入的新密码不一致");
      return;
    }

    if (newPassword.length < 6) {
      setError("密码长度至少6位");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "修改失败");
      } else {
        if (isForced) {
          await signOut({ redirect: false });
          router.push("/login");
        } else {
          router.push("/subscriptions");
        }
        router.refresh();
      }
    } catch {
      setError("修改失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <KeyRound className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">
            {isForced ? "首次登录，请修改密码" : "修改密码"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oldPassword">原密码</Label>
              <Input
                id="oldPassword"
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={isForced ? "默认密码: admin123" : "请输入原密码"}
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="请输入新密码 (至少6位)"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="请再次输入新密码"
                required
                disabled={loading}
              />
            </div>
            {error && (
              <div className="text-sm text-destructive text-center">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "修改中..." : "确认修改"}
            </Button>
            {!isForced && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => router.push("/subscriptions")}
                disabled={loading}
              >
                <ArrowLeft className="h-4 w-4 mr-2" />
                返回首页
              </Button>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-muted-foreground">加载中...</div>
        </div>
      }
    >
      <ChangePasswordForm />
    </Suspense>
  );
}
