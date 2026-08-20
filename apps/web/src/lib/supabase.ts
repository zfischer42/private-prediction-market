import { createClient } from '@supabase/supabase-js';

// Connects to our Supabase project. Also stores/refreshes the sign-in
// session in the browser automatically - nothing else to set up for that.
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);

// Redirects the user to Google's sign-in screen, then back to the app.
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
  });
  if (error) return { error: error.message };
  return { data };
}

// Returns the signed-in user, or null if nobody's signed in.
export async function getCurrentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// Signs the user out and clears the stored session.
export async function signOut() {
  await supabase.auth.signOut();
}
