import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptionById } from '@/lib/db'
import { decryptApiKey } from '@/lib/encryption'

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

    const supportedProviders = ['deepseek', 'moonshot', 'siliconflow', 'openrouter']
    if (!supportedProviders.includes(subscription.provider)) {
      return NextResponse.json(
        { error: `Balance query is only supported for ${supportedProviders.join(', ')} providers` },
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
      const response = await fetchWithTimeout('https://api.moonshot.cn/v1/users/me/balance', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, TIMEOUT)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Moonshot API error:', response.status, errorText)
        return NextResponse.json(
          { error: `Moonshot API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      const availableBalance = data?.data?.available_balance
      const voucherBalance = data?.data?.voucher_balance
      const cashBalance = data?.data?.cash_balance

      if (typeof availableBalance !== 'number') {
        return NextResponse.json(
          { error: 'Unexpected Moonshot API response format' },
          { status: 502 }
        )
      }

      return NextResponse.json({
        provider: 'moonshot',
        isAvailable: data.status && availableBalance > 0,
        balanceInfos: [{
          currency: 'CNY',
          totalBalance: availableBalance.toFixed(2),
          grantedBalance: (typeof voucherBalance === 'number' ? voucherBalance : 0).toFixed(2),
          toppedUpBalance: (typeof cashBalance === 'number' ? cashBalance : 0).toFixed(2)
        }]
      }, {
        headers: { 'Cache-Control': 'no-store' }
      })
    }

    if (subscription.provider === 'deepseek') {
      const response = await fetchWithTimeout('https://api.deepseek.com/user/balance', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, TIMEOUT)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('DeepSeek API error:', response.status, errorText)
        return NextResponse.json(
          { error: `DeepSeek API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      return NextResponse.json({
        provider: 'deepseek',
        isAvailable: data.is_available ?? false,
        balanceInfos: (data.balance_infos || []).map((info: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }) => ({
          currency: info.currency || 'USD',
          totalBalance: info.total_balance || '0',
          grantedBalance: info.granted_balance || '0',
          toppedUpBalance: info.topped_up_balance || '0'
        }))
      }, {
        headers: { 'Cache-Control': 'no-store' }
      })
    }

    if (subscription.provider === 'siliconflow') {
      const response = await fetchWithTimeout('https://api.siliconflow.cn/v1/user/info', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, TIMEOUT)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('SiliconFlow API error:', response.status, errorText)
        return NextResponse.json(
          { error: `SiliconFlow API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      if (data.code !== 20000 || !data.status) {
        console.error('SiliconFlow API error:', data)
        return NextResponse.json(
          { error: data.message || 'SiliconFlow API error' },
          { status: 502 }
        )
      }

      const totalBalance = data.data?.totalBalance
      const balance = data.data?.balance
      const chargeBalance = data.data?.chargeBalance
      const status = data.data?.status

      if (!totalBalance || !status) {
        return NextResponse.json(
          { error: 'Unexpected SiliconFlow API response format' },
          { status: 502 }
        )
      }

      return NextResponse.json({
        provider: 'siliconflow',
        isAvailable: status === 'normal' && parseFloat(totalBalance) > 0,
        balanceInfos: [{
          currency: 'CNY',
          totalBalance: totalBalance,
          grantedBalance: balance || '0',
          toppedUpBalance: chargeBalance || '0'
        }]
      }, {
        headers: { 'Cache-Control': 'no-store' }
      })
    }

    if (subscription.provider === 'openrouter') {
      const response = await fetchWithTimeout('https://openrouter.ai/api/v1/credits', {
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, TIMEOUT)

      if (!response.ok) {
        const errorText = await response.text()
        console.error('OpenRouter API error:', response.status, errorText)
        return NextResponse.json(
          { error: `OpenRouter API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      const totalCredits = data?.data?.total_credits
      const totalUsage = data?.data?.total_usage

      if (typeof totalCredits !== 'number' || typeof totalUsage !== 'number') {
        return NextResponse.json(
          { error: 'Unexpected OpenRouter API response format' },
          { status: 502 }
        )
      }

      const remainingCredits = (totalCredits - totalUsage).toFixed(2)

      return NextResponse.json({
        provider: 'openrouter',
        isAvailable: parseFloat(remainingCredits) > 0,
        balanceInfos: [{
          currency: 'USD',
          totalBalance: remainingCredits,
          grantedBalance: totalCredits.toFixed(2),
          toppedUpBalance: totalUsage.toFixed(2)
        }]
      }, {
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
        { error: 'Balance query timed out' },
        { status: 504 }
      )
    }
    console.error('GET /api/subscriptions/[id]/balance error:', error)
    return NextResponse.json(
      { error: 'Failed to query balance' },
      { status: 500 }
    )
  }
}
