"use client";

import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Subscription,
  SubscriptionFormData,
  SubscriptionStatus,
  SubscriptionType,
  BillingCycle,
  defaultCategories,
  Provider,
  defaultProviders,
  ResetSchedule,
  CredentialField,
  PlanDefinition,
} from "@/lib/types";
import { ResetScheduleConfig } from "@/components/ResetScheduleConfig";
import {
  Loader2,
  CheckCircle,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface SubscriptionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscription?: Subscription | null;
  categories: string[];
  onSubmit: (data: SubscriptionFormData) => void;
}

const initialFormData: SubscriptionFormData = {
  name: "",
  category: defaultCategories[0],
  provider: "other",
  providerCustom: "",
  subscriptionType: "recurring",
  billingCycle: "monthly",
  price: 0,
  startDate: "",
  renewalDate: "",
  status: "active",
  notes: "",
  credentials: {},
  balance: undefined,
  lowBalanceThreshold: undefined,
  resetSchedules: [],
  planId: undefined,
};

export function SubscriptionForm({
  open,
  onOpenChange,
  subscription,
  categories,
  onSubmit,
}: SubscriptionFormProps) {
  const [formData, setFormData] =
    useState<SubscriptionFormData>(initialFormData);
  const [providers, setProviders] = useState<Provider[]>(defaultProviders);
  const providerConfig = providers.find((p) => p.id === formData.provider);
  const plans = providerConfig?.plans ?? [];
  const showPlanSelector =
    formData.subscriptionType === "recurring" && plans.length > 1;
  const selectedPlan: PlanDefinition | undefined = plans.find(
    (p) => p.id === formData.planId
  );
  const planUsageApiUrl = selectedPlan?.usageApiUrl;
  const hasQuerySupport = !!(
    providerConfig?.balanceApiUrl ||
    planUsageApiUrl ||
    (plans.length === 1 && plans[0].usageApiUrl) ||
    (!formData.planId && providerConfig?.usageApiUrl)
  );
  const hasBalanceQuery = !!providerConfig?.balanceApiUrl;
  const credentialFields = providerConfig?.credentialFields || [];

  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  const firstCredentialRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/providers")
      .then((res) => res.json())
      .then((data) => setProviders(data))
      .catch(() => setProviders(defaultProviders));
  }, []);

  useEffect(() => {
    if (subscription) {
      setFormData({
        name: subscription.name,
        category: subscription.category,
        provider: subscription.provider || "other",
        providerCustom: subscription.providerCustom || "",
        subscriptionType: subscription.subscriptionType || "recurring",
        billingCycle: subscription.billingCycle || "monthly",
        price: subscription.price,
        startDate: subscription.startDate || "",
        renewalDate: subscription.renewalDate || "",
        status: subscription.status,
        notes: subscription.notes || "",
        credentials: {},
        balance: subscription.balance,
        lowBalanceThreshold: subscription.lowBalanceThreshold,
        resetSchedules: subscription.resetSchedules || [],
        planId: subscription.planId,
      });
      // Auto-expand if editing without credentials
      const hasExistingCreds = subscription.hasCredentials === true;
      if (!hasExistingCreds) {
        setCredentialsOpen(true);
      } else {
        setCredentialsOpen(false);
      }
      setTestResult(null);
    } else {
      setFormData(initialFormData);
      setCredentialsOpen(false);
      setTestResult(null);
    }
  }, [subscription, open]);

  // Focus first credential input when section expands
  useEffect(() => {
    if (credentialsOpen && firstCredentialRef.current) {
      firstCredentialRef.current.focus();
    }
  }, [credentialsOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: SubscriptionFormData = {
      ...formData,
      lowBalanceThreshold: formData.lowBalanceThreshold ?? null,
    };
    onSubmit(payload);
    onOpenChange(false);
  };

  const handleInputChange = (
    field: keyof SubscriptionFormData,
    value: string | number
  ) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleCredentialChange = (key: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      credentials: {
        ...prev.credentials,
        [key]: value,
      },
    }));
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (
      !formData.provider ||
      !formData.credentials ||
      Object.keys(formData.credentials).length === 0
    )
      return;
    setTestLoading(true);
    setTestResult(null);
    // For plan-based providers, send the effective planId:
    // - explicit planId if set (multi-plan selector)
    // - otherwise the single plan's id if provider has exactly one plan
    const effectivePlanId =
      formData.planId || (plans.length === 1 ? plans[0].id : undefined);
    try {
      const res = await fetch("/api/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: formData.provider,
          planId: effectivePlanId,
          credentials: formData.credentials,
        }),
      });
      const data = await res.json();
      setTestResult({
        ok: data.ok ?? false,
        message: data.message || (data.error ?? "未知错误"),
      });
    } catch {
      setTestResult({ ok: false, message: "网络请求失败" });
    } finally {
      setTestLoading(false);
    }
  };

  const showCustomProvider = formData.provider === "other";
  const isRecurring = formData.subscriptionType === "recurring";
  const billingCycle = formData.billingCycle || "monthly";

  const priceLabel = isRecurring
    ? billingCycle === "yearly"
      ? "价格 (¥/年)"
      : "价格 (¥/月)"
    : "充值金额 (¥)";

  const hasExistingCredentials = subscription?.hasCredentials === true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle>{subscription ? "编辑订阅" : "添加订阅"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="grid gap-3 py-3">
            <div className="grid gap-2">
              <Label htmlFor="name">名称 *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => handleInputChange("name", e.target.value)}
                placeholder="输入订阅名称"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="category">分类 *</Label>
                <Select
                  value={formData.category}
                  onValueChange={(value) =>
                    handleInputChange("category", value)
                  }
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
                  onValueChange={(value) => {
                    setFormData((prev) => ({
                      ...prev,
                      provider: value,
                      planId: undefined,
                    }));
                  }}
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
                  onChange={(e) =>
                    handleInputChange("providerCustom", e.target.value)
                  }
                  placeholder="输入自定义提供商名称"
                  required={showCustomProvider}
                />
              </div>
            )}
            {showPlanSelector && (
              <div className="grid gap-2">
                <Label htmlFor="planId">方案 *</Label>
                <Select
                  value={formData.planId || ""}
                  onValueChange={(value) =>
                    setFormData((prev) => ({
                      ...prev,
                      planId: value || undefined,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择方案" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="subscriptionType">订阅类型 *</Label>
                <Select
                  value={formData.subscriptionType}
                  onValueChange={(value) => {
                    setFormData((prev) => ({
                      ...prev,
                      subscriptionType: value as SubscriptionType,
                      planId: undefined,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择类型" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recurring">周期性</SelectItem>
                    <SelectItem value="one-time">一次性</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {isRecurring ? (
                <div className="grid gap-2">
                  <Label htmlFor="billingCycle">计费周期 *</Label>
                  <Select
                    value={billingCycle}
                    onValueChange={(value) =>
                      handleInputChange("billingCycle", value as BillingCycle)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="选择周期" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">月度</SelectItem>
                      <SelectItem value="yearly">年度</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="status">状态</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) =>
                      handleInputChange("status", value as SubscriptionStatus)
                    }
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
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="price">{priceLabel} *</Label>
                <Input
                  id="price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.price}
                  onChange={(e) =>
                    handleInputChange("price", parseFloat(e.target.value) || 0)
                  }
                  placeholder="0.00"
                  required
                />
              </div>
              {isRecurring && (
                <div className="grid gap-2">
                  <Label htmlFor="status">状态</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value) =>
                      handleInputChange("status", value as SubscriptionStatus)
                    }
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
              )}
            </div>
            {!isRecurring && !hasBalanceQuery && (
              <div className="grid gap-2">
                <Label htmlFor="balance">余额 (¥)</Label>
                <Input
                  id="balance"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.balance ?? ""}
                  onChange={(e) =>
                    handleInputChange(
                      "balance",
                      e.target.value ? parseFloat(e.target.value) : 0
                    )
                  }
                  placeholder="手动输入余额"
                />
              </div>
            )}
            {!isRecurring && (
              <div className="grid gap-2">
                <Label htmlFor="lowBalanceThreshold">低余额阈值 (¥)</Label>
                <Input
                  id="lowBalanceThreshold"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.lowBalanceThreshold ?? ""}
                  onChange={(e) => {
                    if (!e.target.value) {
                      setFormData((prev) => ({
                        ...prev,
                        lowBalanceThreshold: undefined,
                      }));
                      return;
                    }
                    const parsed = parseFloat(e.target.value);
                    if (!Number.isNaN(parsed) && parsed >= 0) {
                      setFormData((prev) => ({
                        ...prev,
                        lowBalanceThreshold: parsed,
                      }));
                    }
                  }}
                  placeholder="留空使用全局默认阈值"
                />
              </div>
            )}
            {isRecurring && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label htmlFor="startDate">开始日期 *</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={formData.startDate || ""}
                    onChange={(e) =>
                      handleInputChange("startDate", e.target.value)
                    }
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="renewalDate">续费日期 *</Label>
                  <Input
                    id="renewalDate"
                    type="date"
                    value={formData.renewalDate || ""}
                    onChange={(e) =>
                      handleInputChange("renewalDate", e.target.value)
                    }
                    required
                  />
                </div>
              </div>
            )}
            {isRecurring && (
              <div className="grid gap-2">
                <ResetScheduleConfig
                  schedules={formData.resetSchedules || []}
                  onChange={(schedules) =>
                    setFormData((prev) => ({
                      ...prev,
                      resetSchedules: schedules,
                    }))
                  }
                />
              </div>
            )}
            {hasQuerySupport && credentialFields.length > 0 && (
              <div className="grid gap-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setCredentialsOpen(!credentialsOpen)}
                >
                  {credentialsOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                  认证凭据
                  {hasExistingCredentials && (
                    <span className="text-xs text-green-600 ml-1">已配置</span>
                  )}
                </button>
                {credentialsOpen && (
                  <div className="grid gap-2 pl-5 border-l-2 border-muted">
                    {credentialFields.map(
                      (field: CredentialField, idx: number) => (
                        <div key={field.key} className="grid gap-1">
                          <Label htmlFor={`cred-${field.key}`}>
                            {field.label}
                          </Label>
                          <Input
                            id={`cred-${field.key}`}
                            ref={idx === 0 ? firstCredentialRef : undefined}
                            type={
                              field.type === "password" ? "password" : "text"
                            }
                            value={formData.credentials?.[field.key] || ""}
                            onChange={(e) =>
                              handleCredentialChange(field.key, e.target.value)
                            }
                            placeholder={
                              hasExistingCredentials
                                ? "已配置，留空保持不变"
                                : `输入 ${field.label}`
                            }
                          />
                        </div>
                      )
                    )}
                    <div className="flex items-center gap-2 mt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleTestConnection}
                        disabled={testLoading}
                      >
                        {testLoading ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : null}
                        测试连接
                      </Button>
                      {testResult && (
                        <span
                          className={`text-xs flex items-center gap-1 ${testResult.ok ? "text-green-600" : "text-red-500"}`}
                        >
                          {testResult.ok ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {testResult.message}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="notes">备注</Label>
              <Input
                id="notes"
                value={formData.notes}
                onChange={(e) => handleInputChange("notes", e.target.value)}
                placeholder="可选备注信息"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit">{subscription ? "保存" : "添加"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
