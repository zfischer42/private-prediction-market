// Stand-in for @supabase/supabase-js for `pnpm demo`. The real app runs unchanged against a
// real Postgres (PGlite, compiled to WASM) with the real schema and RLS, signed in as one of
// three fake users. Nothing leaves the browser tab, and a reload gives a fresh, re-seeded demo.
import { PGlite } from '@electric-sql/pglite';
import shimSql from '../shim.sql?raw';
import schemaSql from '../../supabase/migrations/0001_initial.sql?raw';
import { createClient as baseCreateClient, __bind, __setUser, __query } from '../fakeclient.mjs';
import { seed } from './seed.mjs';
import { mountSwitcher } from './switcher.mjs';

export const USERS = [
  { key: 'alice', id: '00000000-0000-0000-0000-00000000000a', email: 'alice@demo.test', name: 'Alice Admin' },
  { key: 'bob', id: '00000000-0000-0000-0000-00000000000b', email: 'bob@demo.test', name: 'Bob Betts' },
  { key: 'cara', id: '00000000-0000-0000-0000-00000000000c', email: 'cara@demo.test', name: 'Cara Close' },
];

const idOf = (key) => USERS.find((u) => u.key === key)?.id ?? null;
const STORE = 'ppm-demo-user';

let db;
let currentKey = sessionStorage.getItem(STORE) ?? 'alice';
if (currentKey === 'null') currentKey = null;
const listeners = new Set();
const seedClient = baseCreateClient();

// ---- Storage --------------------------------------------------------------
// The files themselves live in memory. Everything that DECIDES anything is real: the bucket's
// size and type limits are read from storage.buckets, and each upload, delete and read goes
// through storage.objects as the signed-in user, so the actual policies (member check, file
// cap, circle and bucket quotas, who may delete) run exactly as they would in Supabase.
const blobs = new Map();

const failure = (message, statusCode) => ({ data: null, error: { message, statusCode } });
const cleanError = (e) => e.message.replace(/^ERROR:\s*/, '');

// `gated` waits for the database to be ready. The seed runs INSIDE that startup, so it has to
// use the ungated one or it would wait on itself.
function bucketApi(bucket, gated = true) {
  const gate = () => (gated ? ready : undefined);
  return {
    async upload(path, file, opts = {}) {
      await gate();
      const rules = (await db.query(
        'select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket])).rows[0] ?? {};
      const type = opts.contentType ?? file.type ?? '';
      if (rules.file_size_limit != null && file.size > Number(rules.file_size_limit)) {
        return failure('The object exceeded the maximum allowed size', '413');
      }
      if (rules.allowed_mime_types && !rules.allowed_mime_types.includes(type)) {
        return failure(`mime type ${type} is not supported`, '415');
      }
      try {
        await __query(
          `insert into storage.objects (bucket_id, name, owner, metadata)
           values ($1, $2, auth.uid(), jsonb_build_object('size', $3::bigint, 'mimetype', $4::text))`,
          [bucket, path, file.size, type]);
      } catch (e) {
        return failure(cleanError(e), '403');
      }
      blobs.set(path, file);
      return { data: { path }, error: null };
    },
    async remove(paths) {
      await gate();
      const removed = [];
      for (const path of paths) {
        const r = await __query(
          'delete from storage.objects where bucket_id = $1 and name = $2 returning name', [bucket, path]);
        if (r.rows.length) { blobs.delete(path); removed.push({ name: path }); }
      }
      return { data: removed, error: null };
    },
    async list(prefix, opts = {}) {
      await gate();
      const r = await __query(
        'select id, name from storage.objects where bucket_id = $1 and name like $2 order by name limit $3',
        [bucket, `${prefix}/%`, opts.limit ?? 100]);
      return { data: r.rows.map((row) => ({ id: row.id, name: row.name.slice(prefix.length + 1) })), error: null };
    },
    async createSignedUrl(path) {
      const { data, error } = await this.createSignedUrls([path]);
      if (error) return failure(error.message);
      return data[0].error ? failure(data[0].error) : { data: { signedUrl: data[0].signedUrl }, error: null };
    },
    async createSignedUrls(paths) {
      await gate();
      const out = [];
      for (const path of paths) {
        const visible = (await __query(
          'select 1 from storage.objects where bucket_id = $1 and name = $2', [bucket, path])).rows.length > 0;
        const blob = blobs.get(path);
        out.push(visible && blob
          ? { path, signedUrl: URL.createObjectURL(blob), error: null }
          : { path, signedUrl: null, error: 'Object not found' });
      }
      return { data: out, error: null };
    },
  };
}
const storage = { from: (bucket) => bucketApi(bucket) };

// A stand-in "photo" so the gallery has something in it: a gradient with a caption.
function drawPhoto(text, hue) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const g = canvas.getContext('2d');
  const fill = g.createLinearGradient(0, 0, 640, 480);
  fill.addColorStop(0, `hsl(${hue} 70% 55%)`);
  fill.addColorStop(1, `hsl(${(hue + 50) % 360} 70% 28%)`);
  g.fillStyle = fill;
  g.fillRect(0, 0, 640, 480);
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = 'bold 42px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText(text, 320, 250);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
}

// Adds a photo as `who`, the way the app does: the file, then the row that describes it.
async function seedPhoto(who, circleId, marketId, caption, hue) {
  const path = `${circleId}/${marketId}/${crypto.randomUUID()}.jpg`;
  __setUser(idOf(who));
  const up = await bucketApi('evidence', false).upload(path, await drawPhoto(caption, hue), { contentType: 'image/jpeg' });
  if (up.error) throw new Error(up.error.message);
  const row = await seedClient
    .from('market_evidence')
    .insert({ market_id: marketId, uploader_id: idOf(who), storage_path: path, media_type: 'image', caption })
    .select()
    .single();
  if (row.error) throw new Error(row.error.message);
}

const ready = (async () => {
  db = await PGlite.create();
  __bind(db);
  await db.exec(shimSql);
  await db.exec(schemaSql);
  for (const u of USERS) {
    await db.query(
      'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)',
      [u.id, u.email, JSON.stringify({ full_name: u.name })],
    );
  }
  await seed({
    as: (key) => {
      __setUser(idOf(key));
      return seedClient;
    },
    sql: async (q, params) => (await db.query(q, params)).rows,
    photo: seedPhoto,
    users: USERS,
  });
  __setUser(idOf(currentKey));
})();

const sessionFor = (key) => {
  const u = USERS.find((x) => x.key === key);
  return u
    ? { access_token: 'demo', user: { id: u.id, email: u.email, user_metadata: { full_name: u.name } } }
    : null;
};

const switcher = mountSwitcher({ users: USERS, getCurrent: () => currentKey, onSwitch: (key) => switchUser(key) });

async function switchUser(key) {
  await ready;
  currentKey = key;
  sessionStorage.setItem(STORE, String(key));
  __setUser(idOf(key));
  for (const cb of listeners) cb(key ? 'SIGNED_IN' : 'SIGNED_OUT', sessionFor(key));
  switcher.refresh();
}

export function createClient() {
  const base = baseCreateClient();
  return {
    from: (table) => {
      const q = base.from(table);
      const origThen = q.then.bind(q);
      q.then = (res, rej) => ready.then(() => origThen(res, rej));
      return q;
    },
    rpc: async (...args) => {
      await ready;
      return base.rpc(...args);
    },
    // Realtime is not simulated: screens refresh after your own actions, not when someone else acts.
    channel: base.channel,
    removeChannel: base.removeChannel,
    storage,
    auth: {
      getSession: async () => {
        await ready;
        return { data: { session: sessionFor(currentKey) } };
      },
      onAuthStateChange: (cb) => {
        listeners.add(cb);
        ready.then(() => cb('INITIAL_SESSION', sessionFor(currentKey)));
        return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } };
      },
      // "Continue with Google" signs in as Alice; use the switcher to be someone else.
      signInWithOAuth: async () => {
        await switchUser('alice');
        return { data: {}, error: null };
      },
      signOut: async () => {
        await switchUser(null);
        return { error: null };
      },
    },
  };
}
