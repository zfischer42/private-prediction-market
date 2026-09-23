import re, sys, glob, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sql = open(os.path.join(ROOT, "supabase/migrations/0001_initial.sql")).read()

# ---- 1. Parse SQL function signatures -------------------------------
sigs = {}
for m in re.finditer(
    r"create or replace function public\.([a-z_]+)\s*\((.*?)\)\s*\n?\s*returns",
    sql, re.S | re.I):
    name, body = m.group(1), m.group(2)
    # Strip trailing "-- comment" text line by line BEFORE splitting on commas.
    # Without this, a comment on the same line as one param's default (e.g.
    # "_closes_at timestamptz default null,  -- v7: omit for ...") merges with
    # the next comma-segment, so the regex below never matches it and that
    # param silently vanishes from `params` - a false "unknown param" for a
    # real, correct call, or worse, a param quietly dropped from `required`
    # with no error at all.
    body = re.sub(r"--.*", "", body)
    params, required = [], []
    for line in body.split(","):
        line = line.strip()
        pm = re.match(r"(_[a-z_]+)\s+([a-z\[\]\s]+?)(\s+default\s+(.*))?$", line, re.I|re.S)
        if pm:
            params.append(pm.group(1))
            if not pm.group(3):
                required.append(pm.group(1))
    sigs[name] = {"params": params, "required": required}

# ---- 2. Parse TS rpc() calls ----------------------------------------
calls = {}
for path in glob.glob(os.path.join(ROOT, "apps/web/src/lib/*.ts")):
    src = open(path).read()
    for m in re.finditer(r"rpc(?:<[^>]*>)?\(\s*'([a-z_]+)'\s*(?:,\s*\{(.*?)\}\s*)?\)", src, re.S):
        name, args = m.group(1), m.group(2) or ""
        keys = re.findall(r"(_[a-z_]+)\s*:", args)
        calls.setdefault(name, []).append((os.path.basename(path), keys))

# ---- 3. Diff --------------------------------------------------------
problems = 0
print(f"{'FUNCTION':<28} {'STATUS'}")
print("-" * 72)
for name in sorted(calls):
    if name not in sigs:
        print(f"{name:<28} !! NO SUCH FUNCTION IN SCHEMA")
        problems += 1
        continue
    sig = sigs[name]
    for fname, keys in calls[name]:
        unknown = [k for k in keys if k not in sig["params"]]
        missing = [k for k in sig["required"] if k not in keys]
        dupes   = [k for k in set(keys) if keys.count(k) > 1]
        if unknown or missing or dupes:
            problems += 1
            print(f"{name:<28} !! {fname}")
            if unknown: print(f"{'':<28}    unknown param(s): {unknown}  (valid: {sig['params']})")
            if missing: print(f"{'':<28}    MISSING required: {missing}")
            if dupes:   print(f"{'':<28}    duplicated: {dupes}")
        else:
            print(f"{name:<28} ok   ({len(keys)}/{len(sig['params'])} params passed)")

print("-" * 72)
uncalled = sorted(set(sigs) - set(calls))
print(f"SQL functions parsed: {len(sigs)}   TS rpc call sites: {sum(len(v) for v in calls.values())}")
print(f"Not wrapped in TS ({len(uncalled)}): {', '.join(uncalled)}")
print(f"\n{'PARAM MISMATCHES: ' + str(problems) if problems else 'NO PARAM MISMATCHES'}")
sys.exit(1 if problems else 0)
