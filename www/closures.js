(function () {
  // ---------- date helpers ----------
  const iso = d => d.toLocaleDateString('en-CA');
  const toLocal = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayNum = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

  // ---------- closure rules ----------
  function isClosed(c, date) {
    const key = iso(date);
    if (c.open && c.open.includes(key)) return false;
    if (c.extra && c.extra.includes(key)) return true;
    const diff = dayNum(date) - dayNum(toLocal(c.anchor));
    if (diff % c.everyDays === 0) return true;
    if (c.alsoMonday && (diff - 3) % c.everyDays === 0) return true;
    return false;
  }
  const closedOn = (date, list) => list.filter(c => isClosed(c, date)).map(c => c.office);

  // ---------- storage ----------
  async function loadClosures() {
    const saved = await localforage.getItem('closures');
    if (saved) return saved;
    try {
      const seed = await (await fetch('closures.json')).json();
      await localforage.setItem('closures', seed);
      return seed;
    } catch (e) {
      return [];
    }
  }

  // ---------- notifications ----------
  async function scheduleHeadsUps(list, daysAhead = 28) {
    const N = window.NativeNotifications || (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications);
    if (!N) return;
    try {
      const perm = await N.requestPermissions();
      if (perm.display !== 'granted') return;
      const pending = await N.getPending();
      if (pending.notifications.length) await N.cancel({ notifications: pending.notifications });

      const out = [];
      const now = new Date();
      for (let i = 0; i <= daysAhead; i++) {
        const day = new Date();
        day.setDate(day.getDate() + i);
        const offices = closedOn(day, list);
        if (!offices.length) continue;
        const base = Number(iso(day).replace(/-/g, ''));

        const evening = new Date(day);
        evening.setDate(evening.getDate() - 1);
        evening.setHours(18, 0, 0, 0);
        if (evening > now) {
          out.push({ id: base, title: 'Tomorrow: ' + offices.length + ' office(s) closed', body: offices.join(', '), schedule: { at: evening } });
        }
        const morning = new Date(day);
        morning.setHours(7, 0, 0, 0);
        if (morning > now) {
          out.push({ id: base + 1, title: 'Closed today', body: offices.join(', '), schedule: { at: morning } });
        }
      }
      if (out.length) await N.schedule({ notifications: out });
    } catch (e) {
      console.error('Closure notifications failed:', e);
    }
  }

  window.initClosures = async function () {
    window.closures = await loadClosures();
    await scheduleHeadsUps(window.closures);
  };

  // ---------- styles ----------
  function addStyles() {
    if (document.getElementById('cl-styles')) return;
    const st = document.createElement('style');
    st.id = 'cl-styles';
    st.textContent = `
      button[onclick="showClosures()"], button[onclick="editClosures()"] {
        padding: 12px 10px !important; border: 1.5px solid var(--brand, #1d5c47); border-radius: 12px;
        background: transparent; color: var(--brand, #1d5c47); font-family: inherit; font-size: 15px; font-weight: 600;
      }
      button[onclick="showClosures()"]:active, button[onclick="editClosures()"]:active { background: var(--brand-tint, #e6f0ea); }
      dialog.cl-dlg {
        border: 0; border-radius: 22px; padding: 0; width: min(92vw, 440px); max-height: 88vh; overflow: auto;
        background: #fff; color: #23302a; box-shadow: 0 20px 60px rgba(0,0,0,.3); font-family: inherit;
      }
      dialog.cl-dlg::backdrop { background: rgba(18,28,23,.5); }
      .cl-wrap { padding: 22px 20px 20px; }
      .cl-wrap h3 { margin: 0 0 14px; font-size: 26px; line-height: 1.1; }
      .cl-card { display: flex; justify-content: space-between; align-items: center; gap: 10px;
        border: 1px solid #e4e0d4; background: #faf9f5; border-radius: 14px; padding: 12px 14px; margin-bottom: 10px; }
      .cl-card b { font-size: 17px; }
      .cl-card small { display: block; color: #6b6a60; margin-top: 3px; font-size: 14px; }
      .cl-day { display: flex; gap: 14px; align-items: center; padding: 10px 0; border-bottom: 1px solid #eeebe2; }
      .cl-day:last-of-type { border-bottom: 0; }
      .cl-date { min-width: 62px; text-align: center; background: var(--brand-tint, #e6f0ea); color: var(--brand, #1d5c47); border-radius: 12px; padding: 6px 4px; line-height: 1.1; }
      .cl-date span { display: block; font-size: 11px; font-weight: 700; letter-spacing: .8px; }
      .cl-date em { font-style: normal; font-size: 24px; font-weight: 700; }
      .cl-offices { flex: 1; font-size: 16px; }
      .cl-empty { color: #6b6a60; padding: 6px 0 10px; }
      .cl-field { margin-bottom: 14px; }
      .cl-field label { display: block; font-size: 12px; font-weight: 700; color: #5d5c52; margin-bottom: 6px; text-transform: uppercase; letter-spacing: .6px; }
      .cl-field input, .cl-field select { width: 100%; box-sizing: border-box; min-height: 46px; padding: 10px 12px;
        border: 1.5px solid #d8d4c6; border-radius: 12px; font-size: 16px; font-family: inherit; background: #fff; color: #23302a; }
      .cl-check { display: flex; align-items: center; gap: 10px; font-size: 16px; margin: 4px 0 14px; }
      .cl-check input { width: 22px; height: 22px; accent-color: var(--brand, #1d5c47); }
      .cl-actions { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
      .cl-btn { flex: 1; min-height: 46px; border-radius: 12px; border: 1.5px solid var(--brand, #1d5c47); background: #fff; color: var(--brand, #1d5c47);
        font-size: 16px; font-weight: 600; font-family: inherit; padding: 0 14px; }
      .cl-btn.primary { background: var(--brand, #1d5c47); color: var(--on-brand, #fff); }
      .cl-btn.danger { border-color: var(--rust, #b5651d); color: var(--rust, #b5651d); }
      .cl-btn.small { flex: none; min-height: 38px; padding: 0 16px; }
    `;
    document.head.appendChild(st);
  }

  function makeDialog() {
    addStyles();
    const dlg = document.createElement('dialog');
    dlg.className = 'cl-dlg';
    dlg.addEventListener('click', e => { if (e.target === dlg) { dlg.close(); dlg.remove(); } });
    document.body.appendChild(dlg);
    return dlg;
  }

  // ---------- upcoming list ----------
  window.showClosures = async function () {
    const list = window.closures || await loadClosures();
    let html = '';
    for (let i = 0; i <= 28; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const offices = closedOn(d, list);
      if (!offices.length) continue;
      html += '<div class="cl-day"><div class="cl-date"><span>' +
        d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase() + ' ' +
        d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase() + '</span><em>' + d.getDate() +
        '</em></div><div class="cl-offices">' + offices.map(o => esc(o)).join('<br>') + '</div></div>';
    }
    const dlg = makeDialog();
    dlg.innerHTML = '<div class="cl-wrap"><h3>Upcoming closures</h3>' +
      (html || '<p class="cl-empty">No closures in the next 4 weeks.</p>') +
      '<div class="cl-actions"><button class="cl-btn primary" id="cl-close">Close</button></div></div>';
    dlg.querySelector('#cl-close').onclick = () => { dlg.close(); dlg.remove(); };
    dlg.showModal();
  };

  // ---------- editor ----------
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const parseDates = s => s.split(',').map(x => x.trim()).filter(Boolean);

  window.editClosures = async function () {
    const list = await loadClosures();
    const dlg = makeDialog();

    const save = async () => {
      await localforage.setItem('closures', list);
      window.closures = list;
      await scheduleHeadsUps(list);
    };

    const showList = () => {
      const cards = list.map((c, i) => {
        const weeks = c.everyDays / 7;
        const start = toLocal(c.anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return '<div class="cl-card"><div><b>' + esc(c.office) + '</b><small>Every ' + (weeks === 1 ? 'week' : weeks + ' weeks') +
          ' from ' + start + (c.alsoMonday ? ' + Monday' : '') + '</small></div>' +
          '<button class="cl-btn small" data-edit="' + i + '">Edit</button></div>';
      }).join('');
      dlg.innerHTML = '<div class="cl-wrap"><h3>Office closures</h3>' +
        (cards || '<p class="cl-empty">No offices yet.</p>') +
        '<div class="cl-actions"><button class="cl-btn primary" id="cl-add">Add office</button>' +
        '<button class="cl-btn" id="cl-done">Done</button></div></div>';
      dlg.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => showForm(Number(b.dataset.edit)); });
      dlg.querySelector('#cl-add').onclick = () => showForm(-1);
      dlg.querySelector('#cl-done').onclick = () => { dlg.close(); dlg.remove(); };
    };

    const showForm = i => {
      const c = i >= 0 ? list[i] : { office: '', anchor: '', everyDays: 28, alsoMonday: false, extra: [], open: [] };
      const cycleOptions = [7, 14, 21, 28, 35, 42].map(n =>
        '<option value="' + n + '"' + (n === c.everyDays ? ' selected' : '') + '>' + (n === 7 ? 'Every week' : 'Every ' + (n / 7) + ' weeks') + '</option>'
      ).join('');

      dlg.innerHTML = '<div class="cl-wrap"><h3>' + (i >= 0 ? 'Edit office' : 'Add office') + '</h3>' +
        '<div class="cl-field"><label>Office name</label><input id="f-name" value="' + esc(c.office) + '"></div>' +
        '<div class="cl-field"><label>A Friday they are closed</label><input id="f-anchor" type="date" value="' + c.anchor + '"></div>' +
        '<div class="cl-field"><label>Repeats</label><select id="f-cycle">' + cycleOptions + '</select></div>' +
        '<label class="cl-check"><input id="f-mon" type="checkbox"' + (c.alsoMonday ? ' checked' : '') + '> Also closed the Monday after</label>' +
        '<div class="cl-field"><label>One-off days off</label><input id="f-extra" placeholder="2026-12-24, 2027-01-04" value="' + esc((c.extra || []).join(', ')) + '"></div>' +
        '<div class="cl-field"><label>Open on these normal closure days</label><input id="f-open" placeholder="2026-12-25" value="' + esc((c.open || []).join(', ')) + '"></div>' +
        '<div class="cl-actions"><button class="cl-btn primary" id="save">Save</button>' +
        '<button class="cl-btn" id="cancel">Cancel</button>' +
        (i >= 0 ? '<button class="cl-btn danger" id="del">Delete</button>' : '') + '</div></div>';

      dlg.querySelector('#cancel').onclick = showList;
      if (i >= 0) {
        dlg.querySelector('#del').onclick = async () => {
          if (!confirm('Delete ' + c.office + '?')) return;
          list.splice(i, 1); await save(); showList();
        };
      }
      dlg.querySelector('#save').onclick = async () => {
        const anchor = dlg.querySelector('#f-anchor').value;
        const name = dlg.querySelector('#f-name').value.trim();
        if (!name || !anchor) { alert('Enter a name and a date.'); return; }
        if (toLocal(anchor).getDay() !== 5) { alert('That date is not a Friday.'); return; }
        const entry = {
          office: name, anchor: anchor,
          everyDays: Number(dlg.querySelector('#f-cycle').value),
          alsoMonday: dlg.querySelector('#f-mon').checked,
          extra: parseDates(dlg.querySelector('#f-extra').value),
          open: parseDates(dlg.querySelector('#f-open').value),
        };
        if (i >= 0) list[i] = entry; else list.push(entry);
        await save();
        showList();
      };
    };

    showList();
    dlg.showModal();
  };

  function boot() {
    addStyles();
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) window.initClosures();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
