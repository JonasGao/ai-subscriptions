"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [isInitial, setIsInitial] = useState(false);
  const [checkingInitial, setCheckingInitial] = useState(true);

  useEffect(() => {
    fetch("/api/auth/is-initial")
      .then((res) => res.json())
      .then((data) => {
        setIsInitial(data.isInitial);
        setCheckingInitial(false);
      })
      .catch(() => setCheckingInitial(false));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await signIn("credentials", {
        username,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError("用户名或密码错误");
      } else {
        const sessionRes = await fetch("/api/auth/session");
        const session = await sessionRes.json();

        if (session?.user?.isInitial) {
          router.push("/change-password?force=1");
        } else {
          router.push("/subscriptions");
        }
        router.refresh();
      }
    } catch {
      setError("登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  if (checkingInitial) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Lock className="h-12 w-12 text-primary" />
          </div>
          <CardTitle className="text-2xl">AI订阅管理</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="请输入用户名"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="请输入密码"
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
              {loading ? "登录中..." : "登录"}
            </Button>
            {isInitial && (
              <div className="text-sm text-muted-foreground text-center">
                首次登录，请使用默认凭据登录并修改密码
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
