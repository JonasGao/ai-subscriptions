"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { StatsCards } from "@/components/StatsCards";
import { CategoryPieChart } from "@/components/CategoryPieChart";
import { SubscriptionList } from "@/components/SubscriptionList";
import { CategoryFilter } from "@/components/CategoryFilter";
import { SubscriptionForm } from "@/components/SubscriptionForm";
import { Subscription, SubscriptionFormData, Tag } from "@/lib/types";
import { defaultCategories } from "@/lib/types";
import { Plus, AlertTriangle } from "lucide-react";
import { PriorityManager } from "@/components/PriorityManager";
import { MainPageShell } from "@/components/MainPageShell";

export default function SubscriptionsPage() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [categories, setCategories] = useState<string[]>(defaultCategories);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedCategory") || "all";
    }
    return "all";
  });
  const [selectedStatus, setSelectedStatus] = useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("selectedStatus") || "all";
    }
    return "all";
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editingSubscription, setEditingSubscription] =
    useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [subsRes, catsRes, tagsRes] = await Promise.all([
        fetch("/api/subscriptions"),
        fetch("/api/categories"),
        fetch("/api/tags"),
      ]);

      if (subsRes.ok) {
        const subsData = await subsRes.json();
        setSubscriptions(subsData);
      }

      if (catsRes.ok) {
        const catsData = await catsRes.json();
        setCategories(catsData);
      }

      if (tagsRes.ok) {
        const tagsData = await tagsRes.json();
        setTags(tagsData);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    localStorage.setItem("selectedCategory", category);
  };

  const handleStatusChange = (status: string) => {
    setSelectedStatus(status);
    localStorage.setItem("selectedStatus", status);
  };

  const filteredSubscriptions = subscriptions.filter((sub) => {
    const categoryMatch =
      selectedCategory === "all" || sub.category === selectedCategory;
    const statusMatch =
      selectedStatus === "all" || sub.status === selectedStatus;
    return categoryMatch && statusMatch;
  });

  const refreshTags = async (): Promise<boolean> => {
    try {
      const response = await fetch("/api/tags");
      if (!response.ok) return false;
      setTags(await response.json());
      return true;
    } catch {
      return false;
    }
  };

  const handleFormSubmit = async (
    data: SubscriptionFormData
  ): Promise<boolean> => {
    setErrorMessage(null);
    try {
      if (editingSubscription) {
        const response = await fetch(
          `/api/subscriptions/${editingSubscription.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          }
        );

        if (response.ok) {
          const updated = await response.json();
          setSubscriptions((prev) =>
            prev.map((s) => (s.id === updated.id ? updated : s))
          );
          if (!(await refreshTags())) {
            setErrorMessage("订阅已保存，但标签列表刷新失败，请刷新页面");
          }
          setEditingSubscription(null);
          return true;
        } else {
          const errorData = await response.json();
          setErrorMessage(errorData.error || "保存失败");
          return false;
        }
      } else {
        const response = await fetch("/api/subscriptions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });

        if (response.ok) {
          const newSub = await response.json();
          setSubscriptions((prev) => [...prev, newSub]);

          if (!categories.includes(data.category)) {
            setCategories((prev) => [...prev, data.category]);
          }
          if (!(await refreshTags())) {
            setErrorMessage("订阅已保存，但标签列表刷新失败，请刷新页面");
          }
          setEditingSubscription(null);
          return true;
        } else {
          const errorData = await response.json();
          setErrorMessage(errorData.error || "保存失败");
          return false;
        }
      }
    } catch {
      setErrorMessage("保存订阅时发生错误");
      return false;
    }
  };

  const handleRenameTag = async (tagId: string, name: string): Promise<Tag> => {
    const response = await fetch(`/api/tags/${tagId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "重命名标签失败");

    setTags((previous) =>
      previous.map((tag) => (tag.id === data.id ? data : tag))
    );
    return data;
  };

  const handleDeleteTag = async (tagId: string): Promise<void> => {
    const response = await fetch(`/api/tags/${tagId}`, { method: "DELETE" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "删除标签失败");

    setTags((previous) => previous.filter((tag) => tag.id !== tagId));
    setSubscriptions((previous) =>
      previous.map((subscription) =>
        (subscription.tagIds ?? []).includes(tagId)
          ? {
              ...subscription,
              tagIds: (subscription.tagIds ?? []).filter(
                (item) => item !== tagId
              ),
            }
          : subscription
      )
    );
  };

  const handleEdit = (subscription: Subscription) => {
    setEditingSubscription(subscription);
    setFormOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/subscriptions/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        setSubscriptions((prev) => prev.filter((s) => s.id !== id));
      }
    } catch (error) {
      console.error("Failed to delete subscription:", error);
    }
  };

  const handleSubscriptionStatusChange = async (
    id: string,
    newStatus: "active" | "paused"
  ) => {
    const originalSubscription = subscriptions.find((s) => s.id === id);
    if (!originalSubscription) return;

    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === id
          ? { ...s, status: newStatus, updatedAt: new Date().toISOString() }
          : s
      )
    );

    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        setSubscriptions((prev) =>
          prev.map((s) => (s.id === id ? originalSubscription : s))
        );
        setErrorMessage("状态切换失败，请重试");
      }
    } catch {
      setSubscriptions((prev) =>
        prev.map((s) => (s.id === id ? originalSubscription : s))
      );
      setErrorMessage("网络错误，状态切换失败");
    }
  };

  const handleScheduleToggle = async (
    subscriptionId: string,
    scheduleId: string,
    exhausted: boolean
  ) => {
    const originalSubscription = subscriptions.find(
      (s) => s.id === subscriptionId
    );
    if (!originalSubscription) return;

    try {
      const res = await fetch(
        `/api/subscriptions/${subscriptionId}/schedules/${scheduleId}/toggle`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ exhausted }),
        }
      );

      if (res.ok) {
        const updated = await res.json();
        setSubscriptions((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        );
      } else {
        setErrorMessage("切换额度状态失败，请重试");
      }
    } catch {
      setErrorMessage("网络错误，切换额度状态失败");
    }
  };

  const handleAddNew = () => {
    setEditingSubscription(null);
    setFormOpen(true);
  };

  const handleBalanceUpdate = (
    id: string,
    balance: number,
    currency: string
  ) => {
    setSubscriptions((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, balance, balanceCurrency: currency } : s
      )
    );
  };

  if (loading) {
    return (
      <MainPageShell activePage="subscriptions">
        <div className="flex items-center justify-center h-[400px] text-muted-foreground">
          加载中...
        </div>
      </MainPageShell>
    );
  }

  return (
    <MainPageShell activePage="subscriptions">
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="ml-auto text-red-700 hover:text-red-900"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex flex-col gap-6 animate-fade-in">
        <StatsCards subscriptions={filteredSubscriptions} />

        <CategoryFilter
          categories={categories}
          selectedCategory={selectedCategory}
          selectedStatus={selectedStatus}
          onCategoryChange={handleCategoryChange}
          onStatusChange={handleStatusChange}
        />

        <div>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-semibold">订阅列表</h2>
            <Button onClick={handleAddNew}>
              <Plus className="mr-2 h-4 w-4" />
              添加订阅
            </Button>
          </div>
          <SubscriptionList
            subscriptions={filteredSubscriptions}
            tags={tags}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onStatusChange={handleSubscriptionStatusChange}
            onScheduleToggle={handleScheduleToggle}
            onBalanceUpdate={handleBalanceUpdate}
          />
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">优先级管理</h2>
          <PriorityManager subscriptions={subscriptions} />
        </div>

        <div>
          <CategoryPieChart subscriptions={subscriptions} />
        </div>
      </div>
      <SubscriptionForm
        open={formOpen}
        onOpenChange={setFormOpen}
        subscription={editingSubscription}
        subscriptions={subscriptions}
        categories={categories}
        tags={tags}
        onSubmit={handleFormSubmit}
        onRenameTag={handleRenameTag}
        onDeleteTag={handleDeleteTag}
      />
    </MainPageShell>
  );
}
