import { NextResponse } from 'next/server';
import { addMemory, getAllMemories, searchMemories, deleteMemory } from '@/lib/memoryDb';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const query = searchParams.get('q');

        let memories;
        if (query) {
            memories = searchMemories(query);
        } else {
            memories = getAllMemories();
        }

        return NextResponse.json({ success: true, memories });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { content, category, tags } = body;

        if (!content) {
            return NextResponse.json({ success: false, error: 'Content is required' }, { status: 400 });
        }

        const id = addMemory(content, category, tags);

        return NextResponse.json({ success: true, id, message: 'Memory added successfully' });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const id = searchParams.get('id');

        if (!id) {
            return NextResponse.json({ success: false, error: 'ID is required' }, { status: 400 });
        }

        const deleted = deleteMemory(parseInt(id, 10));

        if (deleted) {
            return NextResponse.json({ success: true, message: 'Memory deleted' });
        } else {
            return NextResponse.json({ success: false, error: 'Memory not found' }, { status: 404 });
        }
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
