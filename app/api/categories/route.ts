import { NextRequest, NextResponse } from "next/server";
import { getCategories, addCategory, deleteCategory } from "@/lib/db";

export async function GET() {
  try {
    const categories = getCategories();
    return NextResponse.json(categories);
  } catch (error) {
    console.error("GET /api/categories error:", error);
    return NextResponse.json(
      { error: "Failed to fetch categories" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const trimmedCategory =
      typeof body.category === "string" ? body.category.trim() : "";

    if (trimmedCategory === "") {
      return NextResponse.json(
        { error: "Category must be a non-empty string" },
        { status: 400 }
      );
    }

    const categories = addCategory(trimmedCategory);
    return NextResponse.json(categories, { status: 201 });
  } catch (error) {
    console.error("POST /api/categories error:", error);
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: "Failed to add category" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("name");

    if (!category) {
      return NextResponse.json(
        { error: "Category name is required" },
        { status: 400 }
      );
    }

    const categories = deleteCategory(category);
    return NextResponse.json(categories);
  } catch (error) {
    console.error("DELETE /api/categories error:", error);
    const message =
      error instanceof Error ? error.message : "Failed to delete category";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
