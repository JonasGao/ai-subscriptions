import { NextRequest, NextResponse } from 'next/server'
import {
  getPrioritySceneById,
  updatePriorityScene,
  deletePriorityScene,
  reorderSubscriptionsInScene
} from '@/lib/priorities'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const scene = getPrioritySceneById(params.id)
    
    if (!scene) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(scene)
  } catch (error) {
    console.error('GET /api/priorities/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch priority scene' },
      { status: 500 }
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    
    if (body.name !== undefined && (typeof body.name !== 'string' || body.name.trim() === '')) {
      return NextResponse.json(
        { error: 'Scene name must be a non-empty string' },
        { status: 400 }
      )
    }
    
    const updatedScene = updatePriorityScene(params.id, body)
    
    if (!updatedScene) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json(updatedScene)
  } catch (error) {
    console.error('PUT /api/priorities/[id] error:', error)
    
    if (error instanceof Error && error.message === 'Scene name already exists') {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      )
    }
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to update priority scene' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deletePriorityScene(params.id)
    
    if (!deleted) {
      return NextResponse.json(
        { error: 'Priority scene not found' },
        { status: 404 }
      )
    }
    
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/priorities/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete priority scene' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json()
    
    if (body.action === 'reorder' && body.subscriptionOrder) {
      if (!Array.isArray(body.subscriptionOrder)) {
        return NextResponse.json(
          { error: 'subscriptionOrder must be an array' },
          { status: 400 }
        )
      }
      
      const updatedScene = reorderSubscriptionsInScene(params.id, body.subscriptionOrder)
      
      if (!updatedScene) {
        return NextResponse.json(
          { error: 'Priority scene not found' },
          { status: 404 }
        )
      }
      
      return NextResponse.json(updatedScene)
    }
    
    return NextResponse.json(
      { error: 'Invalid action. Only reorder is supported' },
      { status: 400 }
    )
  } catch (error) {
    console.error('PATCH /api/priorities/[id] error:', error)
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to reorder subscriptions' },
      { status: 500 }
    )
  }
}