import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
	// In dev, surface a clear message if env vars are missing.
	console.warn('Supabase env vars are missing: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl ?? 'https://xqjyhoxtahfvfvedoljz.supabase.co', supabaseAnonKey ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inhxanlob3h0YWhmdmZ2ZWRvbGp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDYxMzM3MzMsImV4cCI6MjA2MTcwOTczM30.unZyS_3aBRq2F0vv62jquTAy7cX40mE5nZYDRajhNqw');
