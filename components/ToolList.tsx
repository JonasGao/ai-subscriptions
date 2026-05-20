"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tool, defaultProviders } from "@/lib/types"
import { Edit, Trash2 } from "lucide-react"

interface ToolListProps {
  tools: Tool[]
  onEdit: (tool: Tool) => void
  onDelete: (id: string) => void
}

function getProviderName(provider: string, providerCustom?: string): string {
  if (provider === 'other' && providerCustom) {
    return providerCustom
  }
  const found = defaultProviders.find(p => p.id === provider)
  return found?.name || provider
}

export function ToolList({ tools, onEdit, onDelete }: ToolListProps) {
  if (tools.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        暂无工具，点击右上角&ldquo;添加工具&rdquo;按钮创建
      </div>
    )
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
      {tools.map(tool => {
        const providerName = getProviderName(tool.provider, tool.providerCustom)
        
        return (
          <Card key={tool.id} className="flex flex-col">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-lg font-medium">{tool.name}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col flex-1">
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">分类</span>
                  <Badge variant="outline" className="text-xs">{tool.category}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">提供商</span>
                  <span className="text-sm font-medium">{providerName}</span>
                </div>
              </div>
              <div className="flex gap-2 pt-4 mt-auto">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => onEdit(tool)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  编辑
                </Button>
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={() => onDelete(tool.id)}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  删除
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}