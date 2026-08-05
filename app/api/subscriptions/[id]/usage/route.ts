import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptionById, getProviders } from '@/lib/db'
import { decryptApiKey } from '@/lib/encryption'
import { UsageResult, UsageWindow, UsageLimitWindow } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { ...options, cache: 'no-store', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeUsageWindow(raw: unknown): UsageWindow | null {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  const limit = record.limit
  const used = record.used
  const remaining = record.remaining
  const resetTime = record.resetTime ?? record.reset_time

  if (limit === undefined || used === undefined || remaining === undefined || resetTime === undefined) {
    return null
  }

  return {
    limit: String(limit),
    used: String(used),
    remaining: String(remaining),
    resetTime: String(resetTime),
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const subscription = getSubscriptionById(params.id)

    if (!subscription) {
      return NextResponse.json(
        { error: 'Subscription not found' },
        { status: 404 }
      )
    }

    if (subscription.subscriptionType !== 'recurring') {
      return NextResponse.json(
        { error: 'Usage query is only supported for recurring subscriptions' },
        { status: 400 }
      )
    }

    const providers = getProviders()
    const providerConfig = providers.find(p => p.id === subscription.provider)
    if (!providerConfig?.usageApiUrl) {
      return NextResponse.json(
        { error: `Usage query not supported for ${subscription.provider}` },
        { status: 400 }
      )
    }

    if (!subscription.apiKey) {
      return NextResponse.json(
        { error: 'API key is not configured for this subscription' },
        { status: 400 }
      )
    }

    const apiKey = decryptApiKey(subscription.apiKey)
    const TIMEOUT = 10000

    if (subscription.provider === 'moonshot') {
      const response = await fetchWithTimeout(providerConfig.usageApiUrl, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' }
      }, TIMEOUT)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Moonshot usage API error:', response.status, errorText)
        return NextResponse.json(
          { error: `Moonshot usage API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      const usage = normalizeUsageWindow(data?.usage)

      const limits: UsageLimitWindow[] = Array.isArray(data?.limits)
        ? (data.limits as unknown[])
            .map((item) => {
              const record = item as Record<string, unknown>
              const windowRaw = record.window
              const detail = normalizeUsageWindow(record.detail)
              if (!windowRaw || typeof windowRaw !== 'object' || !detail) return null
              const windowRecord = windowRaw as Record<string, unknown>
              return {
                window: {
                  duration: Number(windowRecord.duration) || 0,
                  timeUnit: String(windowRecord.timeUnit ?? ''),
                },
                detail,
              }
            })
            .filter((item): item is UsageLimitWindow => item !== null)
        : []

      const boosterWalletRaw = data?.boosterWallet
      const boosterWallet =
        boosterWalletRaw && typeof boosterWalletRaw === 'object'
          ? (() => {
              const boosterRecord = boosterWalletRaw as Record<string, unknown>
              const balanceRaw = boosterRecord.balance
              const monthlyUsedRaw = boosterRecord.monthlyUsed
              return {
                balance:
                  balanceRaw && typeof balanceRaw === 'object'
                    ? {
                        amount: String((balanceRaw as Record<string, unknown>).amount ?? ''),
                        amountLeft: String((balanceRaw as Record<string, unknown>).amountLeft ?? ''),
                        unit: String((balanceRaw as Record<string, unknown>).unit ?? ''),
                        type: String((balanceRaw as Record<string, unknown>).type ?? ''),
                      }
                    : null,
                monthlyUsed:
                  monthlyUsedRaw && typeof monthlyUsedRaw === 'object'
                    ? {
                        currency: String((monthlyUsedRaw as Record<string, unknown>).currency ?? ''),
                        priceInCents: String((monthlyUsedRaw as Record<string, unknown>).priceInCents ?? ''),
                      }
                    : null,
                status: String(boosterRecord.status ?? ''),
              }
            })()
          : null

      const parallelRaw = data?.parallel
      const parallel =
        parallelRaw && typeof parallelRaw === 'object'
          ? { limit: String((parallelRaw as Record<string, unknown>).limit ?? '') }
          : null

      const membershipRaw = data?.membership
      const membership =
        membershipRaw && typeof membershipRaw === 'object'
          ? { level: String((membershipRaw as Record<string, unknown>).level ?? '') }
          : null

      const result: UsageResult = {
        provider: 'moonshot',
        usage,
        limits,
        boosterWallet,
        parallel,
        membership,
      }

      return NextResponse.json(result, {
        headers: { 'Cache-Control': 'no-store' }
      })
    }

    return NextResponse.json(
      { error: 'Unsupported provider' },
      { status: 400 }
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Usage query timed out' },
        { status: 504 }
      )
    }
    console.error('GET /api/subscriptions/[id]/usage error:', error)
    return NextResponse.json(
      { error: 'Failed to query usage' },
      { status: 500 }
    )
  }
}
