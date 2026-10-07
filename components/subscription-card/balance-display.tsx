import { Fragment, type ReactNode } from "react";
import { BalanceInfo, BalanceResult, Subscription } from "@/lib/types";
import { formatBalance, getProviderCurrency } from "@/lib/utils";

export function BalanceInfoRows({
  balanceInfos,
}: {
  balanceInfos: BalanceInfo[];
}) {
  return (
    <>
      {balanceInfos.map((info) => (
        <Fragment key={info.currency}>
          {info.total !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">总额度</span>
              <span className="text-sm font-medium">
                {formatBalance(info.total, info.currency)}
              </span>
            </div>
          )}
          {info.toppedUp !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">充值余额</span>
              <span className="text-sm font-medium">
                {formatBalance(info.toppedUp, info.currency)}
              </span>
            </div>
          )}
          {info.granted !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">赠送额度</span>
              <span className="text-sm font-medium">
                {formatBalance(info.granted, info.currency)}
              </span>
            </div>
          )}
          {info.used !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">已使用</span>
              <span className="text-sm font-medium">
                {formatBalance(info.used, info.currency)}
              </span>
            </div>
          )}
          {info.frozen !== null && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">冻结金额</span>
              <span className="text-sm font-medium">
                {formatBalance(info.frozen, info.currency)}
              </span>
            </div>
          )}
          {info.extras?.map((extra) => (
            <div
              key={extra.label}
              className="flex items-center justify-between"
            >
              <span className="text-sm text-muted-foreground">
                {extra.label}
              </span>
              <span className="text-sm font-medium">{extra.value}</span>
            </div>
          ))}
        </Fragment>
      ))}
    </>
  );
}

export function OneTimeBalanceRow({
  subscription,
  balance,
  previousBalance,
}: {
  subscription: Subscription;
  balance: BalanceResult | null;
  previousBalance: { amount: number; currency: string } | null;
}) {
  const currency =
    balance?.balanceInfos[0]?.currency ??
    subscription.balanceCurrency ??
    getProviderCurrency(subscription.provider);

  let content: ReactNode;
  if (balance && balance.balanceInfos[0]) {
    const newAmount = balance.balanceInfos[0].available;
    const oldAmountStr = previousBalance
      ? formatBalance(previousBalance.amount, previousBalance.currency)
      : subscription.balance != null
        ? formatBalance(subscription.balance, currency)
        : null;
    const newNum = parseFloat(newAmount);
    const oldNum = previousBalance
      ? previousBalance.amount
      : (subscription.balance ?? NaN);
    const showParen =
      oldAmountStr &&
      Number.isFinite(oldNum) &&
      Number.isFinite(newNum) &&
      newNum !== oldNum;
    content = (
      <>
        <span>{formatBalance(newAmount, currency)}</span>
        {showParen && (
          <span className="ml-1 text-gray-500 font-normal">
            ({oldAmountStr})
          </span>
        )}
      </>
    );
  } else {
    content =
      subscription.balance != null
        ? formatBalance(subscription.balance, currency)
        : "-";
  }

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">余额</span>
      <span className="text-sm font-medium text-green-600">{content}</span>
    </div>
  );
}
