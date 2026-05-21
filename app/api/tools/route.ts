import { NextRequest, NextResponse } from 'next/server'
import { getTools, createTool, reorderTools } from '@/lib/tools'
import { ToolFormData } from '@/lib/types'

export async function GET() {
  try {
    const tools = getTools()
    return NextResponse.json(tools)
  } catch (error) {
    console.error('GET /api/tools error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch tools' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ToolFormData = await request.json()
    
    if (!body.name || body.name.trim() === '') {
      return NextResponse.json(
        { error: 'Tool name is required' },
        { status: 400 }
      )
    }
    
    if (!body.category || body.category.trim() === '') {
      return NextResponse.json(
        { error: 'Tool category is required' },
        { status: 400 }
      )
    }
    
    if (!body.provider || body.provider.trim() === '') {
      return NextResponse.json(
        { error: 'Tool provider is required' },
        { status: 400 }
      )
    }
    
    const newTool = createTool({
      name: body.name.trim(),
      category: body.category.trim(),
      provider: body.provider.trim(),
      providerCustom: body.providerCustom?.trim(),
      forms: body.forms || [],
      isOpenSource: body.isOpenSource || false,
      repoUrl: body.repoUrl?.trim() || undefined,
    })
    
    return NextResponse.json(newTool, { status: 201 })
  } catch (error) {
    console.error('POST /api/tools error:', error)
    
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Failed to create tool' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    
    if (!body.toolIds || !Array.isArray(body.toolIds)) {
      return NextResponse.json(
        { error: 'toolIds array is required' },
        { status: 400 }
      )
    }
    
    const updatedTools = reorderTools(body.toolIds)
    return NextResponse.json(updatedTools)
  } catch (error) {
    console.error('PATCH /api/tools error:', error)
    return NextResponse.json(
      { error: 'Failed to reorder tools' },
      { status: 500 }
    )
  }
}