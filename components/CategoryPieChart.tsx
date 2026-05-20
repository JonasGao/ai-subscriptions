"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Subscription } from "@/lib/types"
import { calculateCategoryStats } from "@/lib/utils"

interface CategoryPieChartProps {
  subscriptions: Subscription[]
}

const COLORS = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#6b7280', // gray
]

export function CategoryPieChart({ subscriptions }: CategoryPieChartProps) {
  const categoryStats = calculateCategoryStats(subscriptions)
  
  const data = Object.entries(categoryStats).map(([name, value]) => ({
    name,
    value
  }))
  
  const total = data.reduce((sum, item) => sum + item.value, 0)
  
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>分类支出分布</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-[100px] text-muted-foreground">
            暂无数据
          </div>
        </CardContent>
      </Card>
    )
  }
  
  return (
    <Card>
      <CardHeader>
        <CardTitle>分类支出分布</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.map((item, index) => {
            const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0'
            return (
              <div key={item.name} className="flex items-center gap-3">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0" 
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <div className="flex-1 flex items-center justify-between">
                  <span className="text-sm font-medium">{item.name}</span>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-muted-foreground">{percent}%</span>
                    <span className="text-sm font-semibold w-24 text-right">¥{item.value.toFixed(2)}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}