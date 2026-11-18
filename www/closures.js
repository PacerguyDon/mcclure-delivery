(function () {
  // ---------- date helpers ----------
  const iso = d => d.toLocaleDateString('en-CA');
  const toLocal = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayNum = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

  // ---------- closure rules ----------
  // pattern: 'weekly' | 'biweekly' | 'both' | 'alternate'; anchor is a Friday or Monday they are closed.
  function ruleFor(c) {
    const fri = toLocal(c.anchor).getDay() === 5;
    switch (c.pattern) {
      case 'weekly':    return { cycle: 7,  offsets: [0] };
      case 'biweekly':  return { cycle: 14, offsets: [0] };
      case 'both':      return { cycle: 14, offsets: fri ? [0, 3] : [0, 11] };   // Friday + Monday, same weekend
      case 'alternate': return { cycle: 14, offsets: fri ? [0, 10] : [0, 4] };   // Friday one weekend, Monday the next
    }
    // older saved entries (everyDays / alsoMonday)
    return { cycle: c.everyDays || 14, offsets: c.alsoMonday ? [0, 3] : [0] };
  }
  function patternOf(c) {
    if (c.pattern) return c.pattern;
    if (c.everyDays === 7) return 'weekly';
    return c.alsoMonday ? 'both' : 'biweekly';
  }
  function isNthWeekday(date, nth, dow) {
    if (date.getDay() !== dow) return false;
    const dom = date.getDate();
    if (nth === -1) { const next = new Date(date); next.setDate(dom + 7); return next.getMonth() !== date.getMonth(); }
    return Math.ceil(dom / 7) === nth;
  }
  function isClosed(c, date) {
    const key = iso(date);
    if (c.open && c.open.includes(key)) return false;
    if (c.extra && c.extra.includes(key)) return true;
    if (c.pattern === 'monthly') return (c.monthly || []).some(r => isNthWeekday(date, r.nth, r.dow));
    const r = ruleFor(c);
    const diff = dayNum(date) - dayNum(toLocal(c.anchor));
    const m = ((diff % r.cycle) + r.cycle) % r.cycle;
    return r.offsets.includes(m);
  }
  const closedOn = (date, list) => list.filter(c => isClosed(c, date)).map(c => c.office);

  const PATTERN_LABELS = {
    weekly: 'Every week',
    biweekly: 'Every other week',
    both: 'Friday + Monday, every other week',
    alternate: 'Alternating: Friday one week, Monday the next',
    monthly: 'Monthly (like first Friday, second Monday)',
  };
  const NTH_NAMES = { '1': 'First', '2': 'Second', '3': 'Third', '4': 'Fourth', '-1': 'Last' };
  const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  function describe(c) {
    if (c.pattern === 'monthly') return (c.monthly || []).map(r => NTH_NAMES[r.nth] + ' ' + DOW_NAMES[r.dow]).join(' + ') + ' of the month';
    const day = toLocal(c.anchor).getDay() === 1 ? 'Monday' : 'Friday';
    switch (patternOf(c)) {
      case 'weekly': return 'Every ' + day;
      case 'biweekly': return 'Every other ' + day;
      case 'both': return 'Friday + Monday, every other week';
      case 'alternate': return 'Alternating Friday / Monday';
    }
  }
  function nextClosures(c, n) {
    const out = [];
    for (let i = 0; i <= 90 && out.length < n; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      if (isClosed(c, d)) out.push(d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }));
    }
    return out;
  }

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
      .cl-preview { background: var(--brand-tint, #e6f0ea); border-radius: 12px; padding: 10px 12px; font-size: 15px; line-height: 1.4; margin: 2px 0 14px; }
      .cl-mrow { display: flex; gap: 8px; margin-bottom: 8px; }
      .cl-mrow select { flex: 1; }
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
        const start = toLocal(c.anchor).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return '<div class="cl-card"><div><b>' + esc(c.office) + '</b><small>' + describe(c) +
          (c.pattern === 'monthly' ? '' : ' from ' + start) + '</small></div>' +
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
      const c = i >= 0 ? list[i] : { office: '', anchor: '', pattern: 'biweekly', extra: [], open: [] };
      const cur = patternOf(c);
      const options = Object.keys(PATTERN_LABELS).map(k =>
        '<option value="' + k + '"' + (k === cur ? ' selected' : '') + '>' + PATTERN_LABELS[k] + '</option>'
      ).join('');
      const rules = (c.monthly && c.monthly.length) ? c.monthly : [{ nth: 1, dow: 5 }];
      const mRow = (n, r) => {
        const nthOpts = [[0, '(none)'], [1, 'First'], [2, 'Second'], [3, 'Third'], [4, 'Fourth'], [-1, 'Last']].map(o =>
          '<option value="' + o[0] + '"' + (r && o[0] === r.nth ? ' selected' : '') + '>' + o[1] + '</option>').join('');
        const dowOpts = [1, 2, 3, 4, 5].map(d =>
          '<option value="' + d + '"' + (r && d === r.dow ? ' selected' : '') + '>' + DOW_NAMES[d] + '</option>').join('');
        return '<div class="cl-mrow"><select id="m' + n + '-nth">' + nthOpts + '</select><select id="m' + n + '-dow">' + dowOpts + '</select></div>';
      };

      dlg.innerHTML = '<div class="cl-wrap"><h3>' + (i >= 0 ? 'Edit office' : 'Add office') + '</h3>' +
        '<div class="cl-field"><label>Office name</label><input id="f-name" value="' + esc(c.office) + '"></div>' +
        '<div class="cl-field"><label>Schedule</label><select id="f-pattern">' + options + '</select></div>' +
        '<div class="cl-field" id="f-anchor-field"><label>A day they are closed (Friday or Monday)</label><input id="f-anchor" type="date" value="' + (c.anchor || '') + '"></div>' +
        '<div class="cl-field" id="f-monthly-field"><label>Closed on (every month)</label>' + mRow(1, rules[0]) + mRow(2, rules[1]) + '</div>' +
        '<div class="cl-preview" id="f-preview"></div>' +
        '<div class="cl-field"><label>One-off days off</label><input id="f-extra" placeholder="2026-12-24, 2027-01-04" value="' + esc((c.extra || []).join(', ')) + '"></div>' +
        '<div class="cl-field"><label>Open on these normal closure days</label><input id="f-open" placeholder="2026-12-25" value="' + esc((c.open || []).join(', ')) + '"></div>' +
        '<div class="cl-actions"><button class="cl-btn primary" id="save">Save</button>' +
        '<button class="cl-btn" id="cancel">Cancel</button>' +
        (i >= 0 ? '<button class="cl-btn danger" id="del">Delete</button>' : '') + '</div></div>';

      const anchorEl = dlg.querySelector('#f-anchor');
      const patternEl = dlg.querySelector('#f-pattern');
      const previewEl = dlg.querySelector('#f-preview');
      const anchorField = dlg.querySelector('#f-anchor-field');
      const monthlyField = dlg.querySelector('#f-monthly-field');
      const readMonthly = () => [1, 2].map(n => ({
        nth: Number(dlg.querySelector('#m' + n + '-nth').value),
        dow: Number(dlg.querySelector('#m' + n + '-dow').value),
      })).filter(r => r.nth !== 0);

      const refresh = () => {
        const monthly = patternEl.value === 'monthly';
        anchorField.style.display = monthly ? 'none' : '';
        monthlyField.style.display = monthly ? '' : 'none';
        let entry;
        if (monthly) {
          const rs = readMonthly();
          if (!rs.length) { previewEl.textContent = 'Pick at least one day of the month.'; return; }
          entry = { pattern: 'monthly', monthly: rs, extra: [], open: [] };
        } else {
          const a = anchorEl.value;
          if (!a) { previewEl.textContent = 'Pick a closed Friday or Monday to see the schedule.'; return; }
          const wd = toLocal(a).getDay();
          if (wd !== 5 && wd !== 1) { previewEl.textContent = 'That date is not a Friday or Monday.'; return; }
          entry = { anchor: a, pattern: patternEl.value, extra: [], open: [] };
        }
        const next = nextClosures(entry, 6);
        previewEl.innerHTML = '<b>Next closures:</b> ' + (next.length ? next.join(' &middot; ') : 'none in the next 3 months');
      };
      anchorEl.addEventListener('change', refresh);
      anchorEl.addEventListener('input', refresh);
      patternEl.addEventListener('change', refresh);
      dlg.querySelectorAll('#f-monthly-field select').forEach(el => el.addEventListener('change', refresh));
      refresh();

      dlg.querySelector('#cancel').onclick = showList;
      if (i >= 0) {
        dlg.querySelector('#del').onclick = async () => {
          if (!confirm('Delete ' + c.office + '?')) return;
          list.splice(i, 1); await save(); showList();
        };
      }
      dlg.querySelector('#save').onclick = async () => {
        const name = dlg.querySelector('#f-name').value.trim();
        if (!name) { alert('Enter a name.'); return; }
        const entry = {
          office: name,
          pattern: patternEl.value,
          extra: parseDates(dlg.querySelector('#f-extra').value),
          open: parseDates(dlg.querySelector('#f-open').value),
        };
        if (entry.pattern === 'monthly') {
          entry.monthly = readMonthly();
          if (!entry.monthly.length) { alert('Pick at least one day of the month.'); return; }
          entry.anchor = '';
        } else {
          const anchor = anchorEl.value;
          if (!anchor) { alert('Enter a date.'); return; }
          const wd = toLocal(anchor).getDay();
          if (wd !== 5 && wd !== 1) { alert('Pick a Friday or a Monday.'); return; }
          entry.anchor = anchor;
        }
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
