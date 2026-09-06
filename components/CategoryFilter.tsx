"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

interface CategoryFilterProps {
  categories: string[];
  selectedCategory: string;
  selectedStatuses: string[];
  onCategoryChange: (category: string) => void;
  onStatusesChange: (statuses: string[]) => void;
}

const statusOptions = [
  { value: "active", label: "活跃" },
  { value: "paused", label: "暂停" },
  { value: "cancelled", label: "已取消" },
];

export function CategoryFilter({
  categories,
  selectedCategory,
  selectedStatuses,
  onCategoryChange,
  onStatusesChange,
}: CategoryFilterProps) {
  const handleStatusToggle = (statusValue: string) => {
    if (selectedStatuses.includes(statusValue)) {
      onStatusesChange(selectedStatuses.filter((s) => s !== statusValue));
    } else {
      onStatusesChange([...selectedStatuses, statusValue]);
    }
  };

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
        <div className="flex items-center gap-4">
          {statusOptions.map((option) => (
            <div key={option.value} className="flex items-center space-x-2">
              <Checkbox
                id={`status-${option.value}`}
                checked={selectedStatuses.includes(option.value)}
                onCheckedChange={() => handleStatusToggle(option.value)}
              />
              <Label
                htmlFor={`status-${option.value}`}
                className="cursor-pointer font-normal"
              >
                {option.label}
              </Label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
