import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ReQueryConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>再次查询确认</DialogTitle>
          <DialogDescription>
            距上次查询不足 60 秒，确定要再次查询吗？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm}>确认查询</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteConfirmDialog({
  open,
  onOpenChange,
  subscriptionName,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subscriptionName: string;
  onDelete: () => void;
}) {
  // Two-step confirmation; the step resets whenever the dialog closes so a
  // reopen always starts from the first confirmation again.
  const [step, setStep] = useState<1 | 2>(1);

  const close = () => {
    setStep(1);
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? "确认删除订阅" : "再次确认删除"}
          </DialogTitle>
          <DialogDescription>
            {step === 1
              ? `确定要删除订阅「${subscriptionName}」吗？`
              : `删除后无法恢复「${subscriptionName}」，确定继续吗？`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            取消
          </Button>
          {step === 1 ? (
            <Button variant="destructive" onClick={() => setStep(2)}>
              继续删除
            </Button>
          ) : (
            <Button
              variant="destructive"
              onClick={() => {
                close();
                onDelete();
              }}
            >
              确认删除
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
