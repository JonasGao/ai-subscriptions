"use client";

import { useEffect, useState } from "react";
import { MainPageShell } from "@/components/MainPageShell";
import { ToolTab } from "@/components/ToolTab";
import { defaultCategories } from "@/lib/types";

export default function ToolsPage() {
  const [categories, setCategories] = useState<string[]>(defaultCategories);

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await fetch("/api/categories");
        if (response.ok) setCategories(await response.json());
      } catch (error) {
        console.error("Failed to load categories:", error);
      }
    };

    void loadCategories();
  }, []);

  return (
    <MainPageShell activePage="tools">
      <ToolTab categories={categories} />
    </MainPageShell>
  );
}
