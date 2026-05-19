import { NextRequest, NextResponse } from 'next/server'
import { getSubscriptions, createSubscription } from '@/lib/db'
import { SubscriptionFormData } from '@/lib/types'

export async function GET() {
  try {
    const subscriptions = getSubscriptions()
    return NextResponse.json(subscriptions)
  } catch (error) {
    console.error('GET /api/subscriptions error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch subscriptions' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: SubscriptionFormData = await request.json()
    
    // Validate required fields
    if (!body.name || !body.category || body.price === undefined || !body.startDate || !body.renewalDate) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }
    
    // Validate types
    if (typeof body.price !== 'number' || body.price < 0) {
      return NextResponse.json(
        { error: 'Price must be a non-negative number' },
        { status: 400 }
      )
    }
    
    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/
    if (!dateRegex.test(body.startDate) || !dateRegex.test(body.renewalDate)) {
      return NextResponse.json(
        { error: 'Dates must be in YYYY-MM-DD format' },
        { status: 400 }
      )
    }
    
    const newSubscription = createSubscription({
      name: body.name,
      category: body.category,
      provider: body.provider || 'other',
      providerCustom: body.providerCustom,
      price: body.price,
      startDate: body.startDate,
      renewalDate: body.renewalDate,
      status: body.status || 'active',
      notes: body.notes
    })
    
    return NextResponse.json(newSubscription, { status: 201 })
  } catch (error) {
    console.error('POST /api/subscriptions error:', error)
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to create subscription' },
      { status: 500 }
    )
  }
}