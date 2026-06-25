"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"

interface CategoryFilterProps {
  categories: string[]
  selectedCategory: string
  selectedStatus: string
  onCategoryChange: (category: string) => void
  onStatusChange: (status: string) => void
  className?: string
}

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '活跃' },
  { value: 'paused', label: '暂停' },
  { value: 'cancelled', label: '已取消' },
]

export function CategoryFilter({
  categories,
  selectedCategory,
  selectedStatus,
  onCategoryChange,
  onStatusChange,
  className,
}: CategoryFilterProps) {
  return (
    <div className={`flex gap-4 flex-wrap ${className || ''}`}>
      <div className="flex items-center gap-2">
        <Label htmlFor="category-filter">分类筛选</Label>
        <Select
          value={selectedCategory}
          onValueChange={onCategoryChange}
        >
          <SelectTrigger id="category-filter" className="w-[150px]">
            <SelectValue placeholder="选择分类" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部分类</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="status-filter">状态筛选</Label>
        <Select
          value={selectedStatus}
          onValueChange={onStatusChange}
        >
          <SelectTrigger id="status-filter" className="w-[150px]">
            <SelectValue placeholder="选择状态" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}