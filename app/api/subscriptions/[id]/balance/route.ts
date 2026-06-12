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

    if (subscription.provider !== 'deepseek') {
      return NextResponse.json(
        { error: 'Balance query is only supported for DeepSeek provider' },
        { status: 400 }
      )
    }

    if (!subscription.apiKey) {
      return NextResponse.json(
        { error: 'API key is not configured for this subscription' },
        { status: 400 }
      )
    }

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
      isAvailable: data.is_available,
      balanceInfos: (data.balance_infos || []).map((info: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }) => ({
        currency: info.currency,
        totalBalance: info.total_balance,
        grantedBalance: info.granted_balance,
        toppedUpBalance: info.topped_up_balance
      }))
    })
  } catch (error) {
    console.error('GET /api/subscriptions/[id]/balance error:', error)
    return NextResponse.json(
      { error: 'Failed to query balance' },
      { status: 500 }
    )
  }
}
