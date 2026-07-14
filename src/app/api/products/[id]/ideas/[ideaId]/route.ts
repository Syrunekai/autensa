import { NextRequest, NextResponse } from 'next/server';
import { updateIdea, deleteArchivedIdea } from '@/lib/autopilot/ideation';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  try {
    const { ideaId } = await params;
    const body = await request.json();
    const idea = updateIdea(ideaId, body);
    if (!idea) return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    return NextResponse.json(idea);
  } catch (error) {
    console.error('Failed to update idea:', error);
    return NextResponse.json({ error: 'Failed to update idea' }, { status: 500 });
  }
}

// Permanently deletes an idea. Only archived ideas can be deleted — archive
// first (PATCH status to 'archived'), then delete.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; ideaId: string }> }
) {
  try {
    const { ideaId } = await params;
    const result = deleteArchivedIdea(ideaId);
    if (result === 'not_found') {
      return NextResponse.json({ error: 'Idea not found' }, { status: 404 });
    }
    if (result === 'not_archived') {
      return NextResponse.json({ error: 'Only archived ideas can be deleted' }, { status: 403 });
    }
    return NextResponse.json({ deleted: ideaId });
  } catch (error) {
    console.error('Failed to delete idea:', error);
    return NextResponse.json({ error: 'Failed to delete idea' }, { status: 500 });
  }
}
