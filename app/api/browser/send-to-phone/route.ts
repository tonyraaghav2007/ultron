import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseClient';

export async function POST(req: NextRequest) {
    try {
        const { title, url, description } = await req.json();

        if (!url) {
            return NextResponse.json({ error: 'URL is required' }, { status: 400 });
        }

        const domain = new URL(url).hostname.replace('www.', '');
        const timestamp = new Date().toISOString();

        // Insert as a 'shared_link' message type into the existing messages table
        const { error } = await supabase
            .from('messages')
            .insert([{
                sender: 'jarvis',
                type: 'shared_link',
                content: JSON.stringify({
                    title: title || 'Untitled Page',
                    url,
                    domain,
                    description: description || '',
                    timestamp,
                }),
                status: 'completed',
            }]);

        if (error) {
            console.error('[SendToPhone] Supabase error:', error);
            return NextResponse.json({ success: false, error: 'Failed to send. Is Supabase configured?' });
        }

        return NextResponse.json({ success: true, message: 'Sent to phone successfully.' });
    } catch (error: any) {
        console.error('[SendToPhone] Error:', error);
        return NextResponse.json(
            { error: `Failed to send: ${error.message}` },
            { status: 500 }
        );
    }
}
