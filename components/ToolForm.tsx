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
import { cn } from "@/lib/utils"
import { Tool, ToolFormData, ToolStatus, defaultCategories, Provider, defaultProviders, allowedToolForms } from "@/lib/types"

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
  forms: [],
  isOpenSource: false,
  repoUrl: '',
  status: 'active',
  notes: '',
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
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
  const [urlError, setUrlError] = useState('')

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
        forms: tool.forms || [],
        isOpenSource: tool.isOpenSource || false,
        repoUrl: tool.repoUrl || '',
        status: tool.status || 'active',
        notes: tool.notes || '',
      })
    } else {
      setFormData(initialFormData)
    }
    setUrlError('')
  }, [tool, open])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (formData.repoUrl && !isValidUrl(formData.repoUrl)) {
      setUrlError('仓库地址必须是有效的 HTTP 或 HTTPS URL')
      return
    }
    onSubmit(formData)
    onOpenChange(false)
  }

  const handleInputChange = (field: keyof ToolFormData, value: string | boolean | string[]) => {
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
            <div className="grid gap-2">
              <Label>工具形式</Label>
              <div className="flex flex-wrap gap-4">
                {allowedToolForms.map((form) => {
                  const isChecked = formData.forms.includes(form)
                  return (
                    <label
                      key={form}
                      className={cn(
                        "flex items-center gap-2 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors",
                        isChecked
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-input hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        checked={isChecked}
                        onChange={() => {
                          const newForms = isChecked
                            ? formData.forms.filter(f => f !== form)
                            : [...formData.forms, form]
                          handleInputChange('forms', newForms)
                        }}
                      />
                      {form}
                    </label>
                  )
                })}
              </div>
            </div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                  checked={formData.isOpenSource}
                  onChange={(e) => {
                    handleInputChange('isOpenSource', e.target.checked)
                    if (!e.target.checked) {
                      handleInputChange('repoUrl', '')
                    }
                  }}
                />
                <span className="text-sm font-medium">开源工具</span>
              </label>
            </div>
            {formData.isOpenSource && (
              <div className="grid gap-2">
                <Label htmlFor="repoUrl">仓库地址</Label>
                <Input
                  id="repoUrl"
                  value={formData.repoUrl}
                  onChange={(e) => {
                    handleInputChange('repoUrl', e.target.value)
                    setUrlError('')
                  }}
                  placeholder="https://github.com/user/repo"
                />
                {urlError && (
                  <p className="text-xs text-destructive">{urlError}</p>
                )}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="status">状态</Label>
              <Select
                value={formData.status}
                onValueChange={(value) => handleInputChange('status', value as ToolStatus)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="选择状态" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">活跃</SelectItem>
                  <SelectItem value="paused">暂停</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notes">备注</Label>
              <textarea
                id="notes"
                className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={formData.notes}
                onChange={(e) => handleInputChange('notes', e.target.value)}
                placeholder="输入备注信息"
                rows={2}
              />
            </div>
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
