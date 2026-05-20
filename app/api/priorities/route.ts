import { NextRequest, NextResponse } from 'next/server'
import { getPriorityScenes, createPriorityScene } from '@/lib/priorities'
import { PrioritySceneFormData } from '@/lib/types'

export async function GET() {
  try {
    const scenes = getPriorityScenes()
    return NextResponse.json({ scenes })
  } catch (error) {
    console.error('GET /api/priorities error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch priority scenes' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: PrioritySceneFormData = await request.json()
    
    if (!body.name || body.name.trim() === '') {
      return NextResponse.json(
        { error: 'Scene name is required' },
        { status: 400 }
      )
    }
    
    const newScene = createPriorityScene({ name: body.name })
    
    return NextResponse.json(newScene, { status: 201 })
  } catch (error) {
    console.error('POST /api/priorities error:', error)
    
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
      { error: 'Failed to create priority scene' },
      { status: 500 }
    )
  }
}