import { NextRequest, NextResponse } from 'next/server'
import { getToolPriorityScenes, createToolPriorityScene } from '@/lib/tool-priorities'
import { ToolPrioritySceneFormData } from '@/lib/types'

export async function GET() {
  try {
    const scenes = getToolPriorityScenes()
    return NextResponse.json({ scenes })
  } catch (error) {
    console.error('GET /api/tool-priorities error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tool priority scenes' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ToolPrioritySceneFormData = await request.json()

    if (!body.name || body.name.trim() === '') {
      return NextResponse.json(
        { error: 'Scene name is required' },
        { status: 400 }
      )
    }

    const newScene = createToolPriorityScene({ name: body.name })

    return NextResponse.json(newScene, { status: 201 })
  } catch (error) {
    console.error('POST /api/tool-priorities error:', error)

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
      { error: 'Failed to create tool priority scene' },
      { status: 500 }
    )
  }
}
