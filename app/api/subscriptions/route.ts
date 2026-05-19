import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptions, createSubscription } from '@/lib/db'
import { SubscriptionFormData } from '@/lib/types'

export async function GET() {
  try {
    const subscriptions = getSubscriptions()
    return NextResponse.json(subscriptions)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SubscriptionFormData = await request.json()
    
    if (!body.name || !body.category || !body.price || !body.startDate || !body.renewalDate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }
    
    const newSubscription = createSubscription({
      name: body.name,
      category: body.category,
      price: body.price,
      startDate: body.startDate,
      renewalDate: body.renewalDate,
      status: body.status || 'active',
      notes: body.notes
    })
    
    return NextResponse.json(newSubscription)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }
}