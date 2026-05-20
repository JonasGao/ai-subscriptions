"use client"

import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tool, ToolFormData, defaultCategories, Provider, defaultProviders } from "@/lib/types"

interface ToolFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tool?: Tool | null
  categories: string[]
  onSubmit: (data: ToolFormData) => void
}

const initialFormData: ToolFormData = {
  name: '',
  category: defaultCategories[0],
  provider: 'other',
  providerCustom: '',
}

export function ToolForm({
  open,
  onOpenChange,
  tool,
  categories,
  onSubmit,
}: ToolFormProps) {
  const [formData, setFormData] = useState<ToolFormData>(initialFormData)
  const [providers, setProviders] = useState<Provider[]>(defaultProviders)
  
  useEffect(() => {
    fetch('/api/providers')
      .then(res => res.json())
      .then(data => setProviders(data))
      .catch(() => setProviders(defaultProviders))
  }, [])
  
  useEffect(() => {
    if (tool) {
      setFormData({
        name: tool.name,
        category: tool.category,
        provider: tool.provider || 'other',
        providerCustom: tool.providerCustom || '',
      })
    } else {
      setFormData(initialFormData)
    }
  }, [tool, open])
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit(formData)
    onOpenChange(false)
  }
  
  const handleInputChange = (field: keyof ToolFormData, value: string) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }))
  }
  
  const showCustomProvider = formData.provider === 'other'
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>
            {tool ? '编辑工具' : '添加工具'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-3 py-3">
            <div className="grid gap-2">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange('name', e.target.value)}
                placeholder="输入工具名称"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="category">分类 *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) => handleInputChange('category', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category} value={category}>
                        {category}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="provider">提供商 *</Label>
                <Select
                  value={formData.provider}
                  onValueChange={(value) => handleInputChange('provider', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择提供商" />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((provider) => (
                      <SelectItem key={provider.id} value={provider.id}>
                        {provider.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {showCustomProvider && (
              <div className="grid gap-2">
                <Label htmlFor="providerCustom">自定义提供商名称 *</Label>
                <Input
                  id="providerCustom"
                  value={formData.providerCustom}
                  onChange={(e) => handleInputChange('providerCustom', e.target.value)}
                  placeholder="输入自定义提供商名称"
                  required={showCustomProvider}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit">
              {tool ? '保存' : '添加'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}