(function () {
  // ---------- date helpers ----------
  const iso = d => d.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const toLocal = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dayNum = d => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);

  // ---------- closure rules ----------
  function isClosed(c, date) {
    const key = iso(date);
    if (c.open && c.open.includes(key)) return false;   // normally closed, but open this time
    if (c.extra && c.extra.includes(key)) return true;  // one-off day off

    const diff = dayNum(date) - dayNum(toLocal(c.anchor));
    if (diff % c.everyDays === 0) return true;                        // the Friday
    if (c.alsoMonday && (diff - 3) % c.everyDays === 0) return true;  // the Monday after
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
          out.push({
            id: base,
            title: 'Tomorrow: ' + offices.length + ' office(s) closed',
            body: offices.join(', '),
            schedule: { at: evening },
          });
        }

        const morning = new Date(day);
        morning.setHours(7, 0, 0, 0);
        if (morning > now) {
          out.push({
            id: base + 1,
            title: 'Closed today',
            body: offices.join(', '),
            schedule: { at: morning },
          });
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

  // ---------- upcoming list ----------
  window.showClosures = async function () {
    const list = window.closures || await loadClosures();
    let html = '';
    for (let i = 0; i <= 28; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const offices = closedOn(d, list);
      if (offices.length) {
        const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        html += '<p><b>' + label + '</b><br>' + offices.join(', ') + '</p>';
      }
    }
    const dlg = document.createElement('dialog');
    dlg.innerHTML = '<h3>Upcoming closures</h3>' + (html || '<p>None in the next 4 weeks.</p>') + '<button>Close</button>';
    dlg.querySelector('button').onclick = () => { dlg.close(); dlg.remove(); };
    document.body.appendChild(dlg);
    dlg.showModal();
  };

  // ---------- editor ----------
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const parseDates = s => s.split(',').map(x => x.trim()).filter(Boolean);

  window.editClosures = async function () {
    const list = await loadClosures();
    const dlg = document.createElement('dialog');
    document.body.appendChild(dlg);

    const save = async () => {
      await localforage.setItem('closures', list);
      window.closures = list;
      await scheduleHeadsUps(list);
    };

    const showList = () => {
      dlg.innerHTML = '<h3>Office closures</h3>' +
        (list.map((c, i) =>
          '<p><b>' + esc(c.office) + '</b><br>Every ' + c.everyDays + ' days from ' + c.anchor +
          (c.alsoMonday ? ' + Monday' : '') + '<br><button data-edit="' + i + '">Edit</button></p>'
        ).join('') || '<p>No offices yet.</p>') +
        '<button id="add">Add office</button> <button id="done">Done</button>';
      dlg.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => showForm(Number(b.dataset.edit)); });
      dlg.querySelector('#add').onclick = () => showForm(-1);
      dlg.querySelector('#done').onclick = () => { dlg.close(); dlg.remove(); };
    };

    const showForm = i => {
      const c = i >= 0 ? list[i] : { office: '', anchor: '', everyDays: 28, alsoMonday: false, extra: [], open: [] };
      const cycleOptions = [7, 14, 21, 28, 35, 42].map(n =>
        '<option value="' + n + '"' + (n === c.everyDays ? ' selected' : '') + '>' + (n / 7) + ' week(s)</option>'
      ).join('');

      dlg.innerHTML =
        '<h3>' + (i >= 0 ? 'Edit' : 'Add') + ' office</h3>' +
        '<p>Name<br><input id="f-name" value="' + esc(c.office) + '"></p>' +
        '<p>A Friday they are closed<br><input id="f-anchor" type="date" value="' + c.anchor + '"></p>' +
        '<p>Repeats every<br><select id="f-cycle">' + cycleOptions + '</select></p>' +
        '<p><label><input id="f-mon" type="checkbox"' + (c.alsoMonday ? ' checked' : '') + '> Also closed the Monday after</label></p>' +
        '<p>One-off days off (YYYY-MM-DD, comma separated)<br><input id="f-extra" value="' + esc((c.extra || []).join(', ')) + '"></p>' +
        '<p>Open on these normal closure days<br><input id="f-open" value="' + esc((c.open || []).join(', ')) + '"></p>' +
        '<button id="save">Save</button> ' + (i >= 0 ? '<button id="del">Delete</button> ' : '') + '<button id="cancel">Cancel</button>';

      dlg.querySelector('#cancel').onclick = showList;
      if (i >= 0) {
        dlg.querySelector('#del').onclick = async () => { list.splice(i, 1); await save(); showList(); };
      }
      dlg.querySelector('#save').onclick = async () => {
        const anchor = dlg.querySelector('#f-anchor').value;
        const name = dlg.querySelector('#f-name').value.trim();
        if (!name || !anchor) { alert('Enter a name and a date.'); return; }
        if (toLocal(anchor).getDay() !== 5) { alert('That date is not a Friday.'); return; }
        const entry = {
          office: name,
          anchor: anchor,
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
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) window.initClosures();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
