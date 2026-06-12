import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptionById } from '@/lib/db'

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

    const supportedProviders = ['deepseek', 'moonshot']
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

    if (subscription.provider === 'moonshot') {
      const response = await fetch('https://api.moonshot.cn/v1/users/me/balance', {
        headers: {
          'Authorization': `Bearer ${subscription.apiKey}`
        }
      })

      if (!response.ok) {
        const errorText = await response.text()
        console.error('Moonshot API error:', response.status, errorText)
        return NextResponse.json(
          { error: `Moonshot API returned ${response.status}` },
          { status: 502 }
        )
      }

      const data = await response.json()

      return NextResponse.json({
        provider: 'moonshot',
        isAvailable: data.status && data.data.available_balance > 0,
        balanceInfos: [{
          currency: 'CNY',
          totalBalance: data.data.available_balance.toFixed(2),
          grantedBalance: data.data.voucher_balance.toFixed(2),
          toppedUpBalance: data.data.cash_balance.toFixed(2)
        }]
      })
    }

    if (subscription.provider === 'deepseek') {
      const response = await fetch('https://api.deepseek.com/user/balance', {
        headers: {
          'Authorization': `Bearer ${subscription.apiKey}`
        }
      })

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
        isAvailable: data.is_available,
        balanceInfos: (data.balance_infos || []).map((info: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }) => ({
          currency: info.currency,
          totalBalance: info.total_balance,
          grantedBalance: info.granted_balance,
          toppedUpBalance: info.topped_up_balance
        }))
      })
    }

    return NextResponse.json(
      { error: 'Unsupported provider' },
      { status: 400 }
    )
  } catch (error) {
    console.error('GET /api/subscriptions/[id]/balance error:', error)
    return NextResponse.json(
      { error: 'Failed to query balance' },
      { status: 500 }
    )
  }
}
