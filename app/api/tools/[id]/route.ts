import { NextRequest, NextResponse } from 'next/server'
import { getToolById, updateTool, deleteTool } from '@/lib/tools'

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const tool = getToolById(params.id)

    if (!tool) {
      return NextResponse.json(
        { error: 'Tool not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(tool)
  } catch (error) {
    console.error('GET /api/tools/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tool' },
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
        { error: 'Tool name must be a non-empty string' },
        { status: 400 }
      )
    }

    if (body.category !== undefined && (typeof body.category !== 'string' || body.category.trim() === '')) {
      return NextResponse.json(
        { error: 'Tool category must be a non-empty string' },
        { status: 400 }
      )
    }

    if (body.repoUrl !== undefined && body.repoUrl !== '' && !isValidUrl(body.repoUrl)) {
      return NextResponse.json(
        { error: 'Repository URL must be a valid HTTP or HTTPS URL' },
        { status: 400 }
      )
    }

    const updatedTool = updateTool(params.id, body)

    if (!updatedTool) {
      return NextResponse.json(
        { error: 'Tool not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(updatedTool)
  } catch (error) {
    console.error('PUT /api/tools/[id] error:', error)

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to update tool' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const deleted = deleteTool(params.id)

    if (!deleted) {
      return NextResponse.json(
        { error: 'Tool not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('DELETE /api/tools/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete tool' },
      { status: 500 }
    )
  }
}
