import { createClient, type Session, type User } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Fail here with something readable. Without this, a missing .env surfaces
// much later as an opaque fetch error against the URL "undefined".
if (!url || !anonKey) {
  throw new Error(
    'Supabase is not configured. Copy apps/web/.env.example to apps/web/.env ' +
    'and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.',
  );
}

// Connects to our Supabase project. Also stores/refreshes the sign-in
// session in the browser automatically - nothing else to set up for that.
export const supabase = createClient(url, anonKey);

// ---------------------------------------------------------------------
// Result shape
//
// Every function in this folder returns either { data } or { error }.
// `error` is the plain-English message the database raised, already safe
// to show the user - e.g. "Not enough coins", "Betting has closed".
//
//   const { data, error } = await placeBet(marketId, optionId, 100);
//   if (error) return showToast(error);
//   console.log('new balance:', data);
// ---------------------------------------------------------------------
export type Result<T> =
  | { data: T; error?: undefined }
  | { data?: undefined; error: string };

// Shown when the request never reached the server at all.
//
// supabase-js catches fetch failures rather than throwing, and reports them
// as status 0 with the raw JS text - "TypeError: Failed to fetch". Every
// other error here is a sentence written for a user, and on a phone, being
// briefly offline is normal rather than exceptional, so this one gets
// translated too.
const OFFLINE = 'Could not reach the server. Check your connection and try again.';

// Length and range limits that live as Postgres CHECK constraints rather than
// as explicit guards inside the database functions. When one trips, Postgres
// reports it as
//
//   new row for relation "markets" violates check constraint "markets_question_check"
//
// which is not something to put in front of someone who just typed a short
// question. Every entry here is a field a user types into, so every one of
// them is reachable from a form.
//
// Keep in sync with the constraints in supabase/migrations/0001_initial.sql.
const CONSTRAINT_MESSAGES: Record<string, string> = {
  circles_name_check: 'A circle name must be 1 to 60 characters.',
  circles_starting_balance_ck: 'The starting balance must be between 1 and 1,000,000.',
  circles_proposal_bond_ck: 'The proposal bond must be between 0 and 100,000.',
  markets_question_check: 'A question must be 3 to 300 characters.',
  market_options_label_check: 'An option must be 1 to 100 characters.',
  comments_body_check: 'A comment must be 1 to 1000 characters.',
  bets_amount_check: 'The amount must be more than zero.',
  circle_members_balance_check: 'That would put the balance below zero.',
  valid_betting_window: 'Betting must close after it opens.',
  over_under_needs_line: 'An over/under market needs a line.',
  market_evidence_media_type_check: 'Evidence must be an image or a video.',
};

function message(error: { message: string }, status?: number): string {
  if (status === 0) return OFFLINE;

  const constraint = error.message.match(/violates check constraint "([a-z_]+)"/)?.[1];
  if (constraint && CONSTRAINT_MESSAGES[constraint]) {
    return CONSTRAINT_MESSAGES[constraint];
  }

  // A constraint we have not named yet. Better a vague sentence than the
  // relation name and constraint identifier.
  if (constraint || /violates (not-null|foreign key)/.test(error.message)) {
    return "That value isn't valid. Check the form and try again.";
  }

  return error.message;
}

// Calls one of the database functions. All the real permission and money
// rules live in there, so there is nothing to re-check on this side.
export async function rpc<T>(
  fn: string,
  args: Record<string, unknown> = {},
): Promise<Result<T>> {
  const { data, error, status } = await supabase.rpc(fn, args);
  if (error) return { error: message(error, status) };
  return { data: data as T };
}

// Wraps a plain table/view read. Row-level security already limits these
// to circles you belong to, so there is no "which circles am I allowed to
// see" filtering to do here.
export async function read<T>(
  query: PromiseLike<{
    data: unknown;
    error: { message: string } | null;
    status?: number;
  }>,
): Promise<Result<T>> {
  const { data, error, status } = await query;
  if (error) return { error: message(error, status) };
  return { data: data as T };
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

// The signed-in user's id, or null. Used by every function that has to
// filter rows to "mine" - bets, comments, memberships.
export async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

// Redirects the user to Google's sign-in screen, then back to the app.
// Without redirectTo, Supabase sends them to whatever Site URL is set in
// the dashboard, which is usually not the page they started on.
//
// On success the browser navigates away, so nothing after this runs.
export async function signInWithGoogle(
  redirectTo: string = window.location.origin,
): Promise<Result<null>> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  if (error) return { error: error.message };
  return { data: null };
}

// Returns the signed-in user, or null if nobody's signed in.
export async function getCurrentUser(): Promise<User | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// The whole session, if you need the access token.
export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

// Signs the user out on THIS device and clears the stored session.
//
// scope: 'local' is not the default. supabase-js signs out GLOBALLY unless you
// say otherwise, revoking the refresh token everywhere - so on a phone-first
// PWA, tapping "sign out" on your phone would also drop you on your laptop.
// That is not what anyone means by the button, and supabase-js's own docs
// recommend 'local' for most apps.
export async function signOut(): Promise<Result<null>> {
  const { error } = await supabase.auth.signOut({ scope: 'local' });
  if (error) return { error: error.message };
  return { data: null };
}

// Fires whenever the user signs in or out, including when they land back
// here from Google. Call it once on app start and keep the user in state;
// otherwise the app still shows the sign-in button after a successful login.
//
// The callback also fires once on subscribe with the session restored from
// storage (supabase-js emits INITIAL_SESSION), so there is no need to call
// getCurrentUser() alongside this - doing both double-fires, and the manual
// read can land after a sign-out and overwrite it with a stale user.
//
// Until that first call arrives you do not yet know whether anyone is
// signed in, which is the difference between "loading" and "signed out":
//
//   const [user, setUser] = useState<User | null | undefined>(undefined);
//   useEffect(() => onAuthChange(setUser), []);
//
// Returns an unsubscribe function - return it straight from useEffect.
export function onAuthChange(callback: (user: User | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session?.user ?? null);
  });
  return () => data.subscription.unsubscribe();
}
