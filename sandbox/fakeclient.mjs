// A stand-in for supabase-js that runs against PGlite instead of PostgREST.
// Enough of the query builder to exercise the read functions in lib/:
// select with one-level embeds, eq/in/is filters, order, limit, single.

let db = null;
let currentUser = null;

export function __bind(pglite) { db = pglite; }
export function __setUser(id) { currentUser = id; }
export function __getUser() { return currentUser; }
// Lets the demo's fake Storage run its own SQL under the signed-in user's role, so RLS applies.
export function __query(sql, params = []) { return asUser(sql, params); }

// Run as the signed-in user so RLS actually applies. Superuser bypasses it.
//
// There is one connection, so calls are queued: an interleaved set-role / query /
// reset-role would run one caller's query under another's role. The tests await one
// call at a time, but the demo's UI fires several in parallel.
let queue = Promise.resolve();
function asUser(sql, params = []) {
  const run = queue.then(() => asUserNow(sql, params));
  queue = run.catch(() => {});
  return run;
}

async function asUserNow(sql, params = []) {
  if (currentUser) {
    await db.exec(`set role authenticated;`);
    await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [currentUser]);
  } else {
    await db.exec(`set role anon;`);
    await db.query(`select set_config('request.jwt.claim.sub', '', false)`);
  }
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec(`reset role;`);
  }
}

const ident = (s) => '"' + String(s).replace(/"/g, '""') + '"';

// Resolve the FK linking two tables. Mirrors PostgREST: if more than one
// relationship exists and the caller gave no !constraint_name hint, refuse
// the embed rather than silently guessing.
async function fkJoin(from, to, hint) {
  const r = await db.query(`
    select con.conname,
           child.relname  as child_table,
           parent.relname as parent_table,
           (select attname from pg_attribute
             where attrelid = con.conrelid and attnum = con.conkey[1]) as local_col,
           (select attname from pg_attribute
             where attrelid = con.confrelid and attnum = con.confkey[1]) as remote_col
    from pg_constraint con
    join pg_class child  on child.oid  = con.conrelid
    join pg_class parent on parent.oid = con.confrelid
    where con.contype = 'f'
      and ((child.relname = $1 and parent.relname = $2)
        or (child.relname = $2 and parent.relname = $1))`, [from, to]);

  let rows = r.rows;
  if (hint) rows = rows.filter(x => x.conname === hint);
  if (!rows.length) {
    throw new Error(hint
      ? `no FK named "${hint}" between ${from} and ${to}`
      : `no FK between ${from} and ${to}`);
  }
  if (rows.length > 1) {
    throw new Error(
      `Could not embed because more than one relationship was found for '${from}' and '${to}'` +
      ` (${rows.map(x => x.conname).join(', ')}) - disambiguate with !constraint_name`);
  }
  const row = rows[0];
  return { local_col: row.local_col, remote_col: row.remote_col, childTable: row.child_table };
}

// "*, markets!inner(*), market_options(*)" -> base cols + embed specs
function parseSelect(sel) {
  const embeds = [];
  let base = '';
  let depth = 0, token = '';
  for (const ch of sel) {
    if (ch === '(') { depth++; token += ch; }
    else if (ch === ')') { depth--; token += ch; }
    else if (ch === ',' && depth === 0) { base += token + ','; token = ''; }
    else token += ch;
  }
  base += token;
  const parts = base.split(',').map(s => s.trim()).filter(Boolean);
  const plain = [];
  for (const p of parts) {
    // [alias:]table[!hint][!inner](cols)
    const m = p.match(/^(?:([a-z_]+):)?([a-z_]+)((?:![a-z_]+)*)\((.*)\)$/i);
    if (m) {
      const mods = (m[3] || '').split('!').filter(Boolean);
      const inner = mods.includes('inner');
      const hint = mods.find(x => x !== 'inner' && x !== 'left') || null;
      embeds.push({ alias: m[1] || m[2], table: m[2], hint, inner, cols: m[4] });
    } else plain.push(p);
  }
  return { plain, embeds };
}

class Query {
  constructor(table) {
    this.table = table;
    this.sel = '*';
    this.filters = [];
    this.orders = [];
    this._limit = null;
    this._single = null;
    this._op = 'select';
    this._payload = null;
  }
  select(sel = '*') { this.sel = sel; if (this._op !== 'select') this._returning = true; return this; }
  insert(payload) { this._op = 'insert'; this._payload = payload; return this; }
  delete() { this._op = 'delete'; return this; }
  eq(col, val) { this.filters.push({ op: '=', col, val }); return this; }
  in(col, vals) { this.filters.push({ op: 'in', col, val: vals }); return this; }
  is(col, val) { this.filters.push({ op: 'is', col, val }); return this; }
  order(col, opts = {}) { this.orders.push({ col, asc: opts.ascending !== false }); return this; }
  limit(n) { this._limit = n; return this; }
  single() { this._single = 'one'; return this; }
  maybeSingle() { this._single = 'maybe'; return this; }

  async _run() {
    if (this._op === 'insert') {
      const cols = Object.keys(this._payload);
      const vals = cols.map((_, i) => `$${i + 1}`);
      const sql = `insert into public.${ident(this.table)} (${cols.map(ident).join(',')})
                   values (${vals.join(',')}) returning *`;
      return asUser(sql, cols.map(c => this._payload[c]));
    }
    if (this._op === 'delete') {
      // no alias on a DELETE, so filters must be built unprefixed
      const { where, params } = this._where(null);
      return asUser(`delete from public.${ident(this.table)} ${where} returning *`, params);
    }
    const { plain, embeds } = parseSelect(this.sel);
    const baseCols = plain.length ? plain.map(c => c === '*' ? 't.*' : `t.${ident(c)}`).join(', ') : 't.*';

    let joins = '', extraCols = '';
    for (const [i, e] of embeds.entries()) {
      const fk = await fkJoin(this.table, e.table, e.hint);
      const alias = `e${i}`;
      this._aliasMap = this._aliasMap || {};
      this._aliasMap[e.alias] = alias;
      if (fk.childTable === this.table) {
        // many-to-one: embed returns a single object
        joins += ` ${e.inner ? 'join' : 'left join'} public.${ident(e.table)} ${alias}
                   on ${alias}.${ident(fk.remote_col)} = t.${ident(fk.local_col)}`;
        extraCols += `, to_jsonb(${alias}.*) as ${ident(e.alias)}`;
      } else {
        // one-to-many: embed returns an array
        extraCols += `, (select coalesce(jsonb_agg(to_jsonb(x.*)), '[]'::jsonb)
                          from public.${ident(e.table)} x
                          where x.${ident(fk.local_col)} = t.${ident(fk.remote_col)}) as ${ident(e.alias)}`;
      }
    }

    const { where, params } = this._where('t', embeds);
    let sql = `select ${baseCols}${extraCols} from public.${ident(this.table)} t${joins} ${where}`;
    if (this.orders.length) {
      sql += ' order by ' + this.orders
        .map(o => `t.${ident(o.col)} ${o.asc ? 'asc' : 'desc'}`).join(', ');
    }
    if (this._limit != null) sql += ` limit ${Number(this._limit)}`;
    return asUser(sql, params);
  }

  _where(alias = 't', embeds = []) {
    const clauses = [], params = [];
    for (const f of this.filters) {
      // "markets.circle_id" targets an embedded table
      const p = alias ? `${alias}.` : '';
      let ref;
      if (f.col.includes('.')) {
        // filters on an embedded resource are addressed by its alias
        const [tbl, col] = f.col.split('.');
        const e = embeds.find(x => x.alias === tbl || x.table === tbl);
        ref = e ? `${this._aliasMap[e.alias]}.${ident(col)}` : `${p}${ident(col)}`;
      } else {
        ref = `${p}${ident(f.col)}`;
      }
      if (f.op === 'is') { clauses.push(`${ref} is ${f.val === null ? 'null' : f.val}`); continue; }
      if (f.op === 'in') {
        params.push(f.val);
        clauses.push(`${ref} = any($${params.length})`);
        continue;
      }
      params.push(f.val);
      clauses.push(`${ref} = $${params.length}`);
    }
    return { where: clauses.length ? 'where ' + clauses.join(' and ') : '', params };
  }

  then(resolve, reject) {
    this._run().then(
      (r) => {
        let data = r.rows;
        if (this._single === 'one') {
          if (data.length !== 1) {
            return resolve({ data: null, error: { message: `expected 1 row, got ${data.length}` } });
          }
          data = data[0];
        } else if (this._single === 'maybe') {
          data = data.length ? data[0] : null;
        }
        resolve({ data, error: null });
      },
      (e) => resolve({ data: null, error: { message: e.message } }),
    ).catch(reject);
  }
}

export function createClient() {
  return {
    from: (table) => new Query(table),
    rpc: async (fn, args = {}) => {
      const keys = Object.keys(args);
      const named = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      try {
        const r = await asUser(`select public.${ident(fn)}(${named}) as result`,
                               keys.map(k => args[k]));
        const v = r.rows[0]?.result;
        return { data: v === undefined ? null : v, error: null };
      } catch (e) {
        return { data: null, error: { message: e.message.replace(/^ERROR:\s*/, '') } };
      }
    },
    auth: {
      getSession: async () => ({
        data: { session: currentUser ? { user: { id: currentUser } } : null },
      }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    // realtime is not simulated - these keep imports of realtime.ts safe
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: async () => 'ok',
    storage: {
      from: () => ({
        upload: async () => ({ data: null, error: { message: 'storage not available in sandbox' } }),
        remove: async () => ({ data: null, error: null }),
        createSignedUrl: async () => ({ data: null, error: { message: 'storage not available in sandbox' } }),
        createSignedUrls: async () => ({ data: null, error: { message: 'storage not available in sandbox' } }),
        list: async () => ({ data: [], error: null }),
      }),
    },
  };
}
