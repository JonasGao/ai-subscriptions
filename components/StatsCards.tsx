"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Subscription } from "@/lib/types"
import { calculateMonthlyTotal, calculateYearlyTotal, calculateOneTimeTotal } from "@/lib/utils"

interface StatsCardsProps {
  subscriptions: Subscription[]
}

export function StatsCards({ subscriptions }: StatsCardsProps) {
  const monthlyTotal = calculateMonthlyTotal(subscriptions)
  const yearlyTotal = calculateYearlyTotal(subscriptions)
  const oneTimeTotal = calculateOneTimeTotal(subscriptions)
  const activeCount = subscriptions.filter(s => s.status === 'active').length
  const recurringCount = subscriptions.filter(s => s.status === 'active' && s.subscriptionType === 'recurring').length
  const oneTimeCount = subscriptions.filter(s => s.status === 'active' && s.subscriptionType === 'one-time').length

  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">月度总支出</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">¥{monthlyTotal.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">周期性订阅 ({recurringCount}个)</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">年度预估</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">¥{yearlyTotal.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">周期性订阅年度费用</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">一次性充值</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">¥{oneTimeTotal.toFixed(2)}</div>
          <p className="text-xs text-muted-foreground">活跃充值 ({oneTimeCount}个)</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">活跃订阅</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{activeCount}</div>
          <p className="text-xs text-muted-foreground">
            共 {subscriptions.length} 个订阅
          </p>
        </CardContent>
      </Card>
    </div>
  )
}