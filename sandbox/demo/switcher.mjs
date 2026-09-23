// A small floating bar for the demo: who you are signed in as, and a way to become someone else.
const STYLE = `
#demo-bar{position:fixed;left:12px;bottom:12px;z-index:9999;display:flex;flex-wrap:wrap;align-items:center;gap:6px;
  max-width:calc(100vw - 24px);padding:6px 8px;border:1px solid rgba(148,163,184,.4);border-radius:12px;
  background:rgba(15,23,42,.94);color:#cbd5e1;font:12px/1.2 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.45)}
#demo-bar b{color:#93c5fd;letter-spacing:.08em}
#demo-bar small{color:#94a3b8;font-size:11px}
#demo-bar button{font:inherit;color:#e2e8f0;background:transparent;border:1px solid rgba(148,163,184,.4);
  border-radius:999px;padding:3px 9px;cursor:pointer}
#demo-bar button[aria-pressed=true]{background:rgba(59,130,246,.28);border-color:#3b82f6}
`;

export function mountSwitcher({ users, getCurrent, onSwitch }) {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.id = 'demo-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Demo controls');
  document.body.append(bar);

  const text = (tag, content) => {
    const el = document.createElement(tag);
    el.textContent = content;
    return el;
  };

  function refresh() {
    const current = getCurrent();
    bar.replaceChildren(text('b', 'DEMO'), text('small', current ? 'signed in as' : 'signed out - switch to'));
    for (const u of users) {
      const btn = text('button', u.name.split(' ')[0]);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(u.key === current));
      btn.addEventListener('click', () => onSwitch(u.key));
      bar.append(btn);
    }
    bar.append(text('small', 'Data lives in this tab. Reload to reset.'));
  }

  refresh();
  return { refresh };
}
