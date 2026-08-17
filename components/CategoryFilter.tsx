"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface CategoryFilterProps {
  categories: string[];
  selectedCategory: string;
  selectedStatus: string;
  onCategoryChange: (category: string) => void;
  onStatusChange: (status: string) => void;
}

const statusOptions = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "活跃" },
  { value: "paused", label: "暂停" },
  { value: "cancelled", label: "已取消" },
];

export function CategoryFilter({
  categories,
  selectedCategory,
  selectedStatus,
  onCategoryChange,
  onStatusChange,
}: CategoryFilterProps) {
  return (
    <div className="flex gap-4 flex-wrap">
      <div className="flex items-center gap-2">
        <Label htmlFor="category-filter">分类筛选</Label>
        <Select value={selectedCategory} onValueChange={onCategoryChange}>
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
      <div className="flex items-center gap-3">
        <Label>状态筛选</Label>
        <RadioGroup
          value={selectedStatus}
          onValueChange={onStatusChange}
          className="flex items-center gap-4"
        >
          {statusOptions.map((option) => (
            <div key={option.value} className="flex items-center space-x-2">
              <RadioGroupItem
                value={option.value}
                id={`status-${option.value}`}
              />
              <Label
                htmlFor={`status-${option.value}`}
                className="cursor-pointer font-normal"
              >
                {option.label}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
