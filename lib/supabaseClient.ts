import { createClient } from '@supabase/supabase-js';

// We fall back to empty strings if not provided so the build doesn't crash,
// but the relay won't work until the user provides the keys in .env.local
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: false // Server-side usage doesn't need to persist a session
    }
});
