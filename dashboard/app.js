// Token Radar console. Reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable table, a per-protocol detail panel with the model's own arithmetic and
// the protocol's farm plan, and the live-token comps the model is priced from. No network, no fetch:
// every byte it shows arrived in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', category: 'all', chain: 'all', minTvl: 0, watchlistOnly: false, view: 'board', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + ' yrs';
    return Math.round(days) + ' days';
  }

  // The model, restated in the page: a row's implied value is recomputed from the snapshot figures
  // and the category multiple the board carries, so a reader can check the page against board.json.
  function impliedOf(row) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var momentum = 1 + (growth / 100) * m.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? m.unknown_age_days : row.age_days;
    var track = m.age_floor_mult + (1 - m.age_floor_mult) * (Math.min(Math.max(age, 0), m.age_cap_days) / m.age_cap_days);
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * momentum * track));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) node.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('watchlist') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watchlist', '1');
    if (state.selected) params.set('p', state.selected);
    var s = params.toString();
    window.history.replaceState(null, '', s ? '#' + s : window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'multiple') { av = a.category_multiple; bv = b.category_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }

  function masthead() {
    return el('header', { class: 'masthead' },
      el('div', { class: 'logo' }, el('span', { class: 'ring' }), 'Token Radar'),
      el('div', { class: 'meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: 'Model ' + DATA.model_version })
      )
    );
  }

  function stats() {
    function stat(label, value) { return el('div', { class: 'stat' }, el('span', { text: label }), el('b', { class: 'num', text: value })); }
    return el('div', { class: 'stats' },
      stat('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
      stat('Pre-token rows ranked', String(DATA.board_size)),
      stat('Early rows below the floor', String(DATA.early_size)),
      stat('Market multiple (median)', DATA.global_multiple.toFixed(2) + 'x TVL'),
      stat('Live tokens set aside', String(DATA.live_size) + ' shown')
    );
  }

  function modelStrip() {
    var m = DATA.model;
    return el('section', { class: 'model-strip' },
      el('h2', { text: 'How a row is priced' }),
      el('p', { text: 'Each pre-token protocol is priced off the protocols that already trade: the median market-cap-to-TVL ratio of its own category (each peer ratio winsorized to 0.02x-3x first), shrunk toward the market median of ' + DATA.global_multiple.toFixed(2) + 'x when a category has few traded peers, then adjusted for seven-day TVL momentum and for how long the protocol has run with no token. One function prices every row; no name is special-cased.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x category_multiple x (1 + clamp(7d change, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.age_floor_mult + ' + ' + (1 - m.age_floor_mult).toFixed(2) + ' x min(age_days, ' + m.age_cap_days + ') / ' + m.age_cap_days + ') )' })
    );
  }

  function toolbar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', placeholder: 'Name, slug, category, chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label }, values.map(function (v) {
        return el('option', { value: v[0], text: v[1], selected: String(current) === String(v[0]) ? 'selected' : null });
      }));
      s.addEventListener('change', function () { onchange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var catSel = select('f-category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; });
    var chainSel = select('f-chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; });
    var tvlSel = select('f-tvl', 'Min TVL', [[0, 'Any size'], [10000000, '$10M+'], [50000000, '$50M+ (the floor)'], [250000000, '$250M+'], [1000000000, '$1B+']], state.minTvl, function (v) { state.minTvl = Number(v); });
    var sortSel = select('f-sort', 'Sort by', [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7d change'], ['age', 'Age'], ['multiple', 'Category multiple'], ['name', 'Name']], state.sort, function (v) { state.sort = v; state.dir = v === 'name' ? 1 : -1; });
    var wl = el('input', { type: 'checkbox', id: 'f-watch', checked: state.watchlistOnly ? true : null });
    wl.addEventListener('change', function () { state.watchlistOnly = wl.checked; writeHash(); render(); });
    var boardBtn = el('button', { type: 'button', 'aria-pressed': state.view === 'board' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.view = 'board'; render(); } });
    var liveBtn = el('button', { type: 'button', 'aria-pressed': state.view === 'live' ? 'true' : 'false', text: 'Live-token comps', onclick: function () { state.view = 'live'; render(); } });
    return el('div', { class: 'toolbar' },
      el('div', { class: 'field' }, el('label', { for: 'f-q', text: 'Search' }), search),
      catSel, chainSel, tvlSel, sortSel,
      el('div', { class: 'field check' }, wl, el('label', { for: 'f-watch', text: 'Watchlist only' })),
      el('div', { class: 'field' }, el('label', { text: 'View' }), el('div', null, boardBtn, ' ', liveBtn)),
      el('span', { class: 'count', id: 'row-count' })
    );
  }

  function sortTh(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
      render();
    } }, label + (state.sort === key ? (state.dir < 0 ? ' ↓' : ' ↑') : '')));
  }

  var tableHost = el('div');
  function renderTable() {
    tableHost.textContent = '';
    var count = document.getElementById('row-count');
    if (state.view === 'live') {
      if (count) count.textContent = DATA.live.length + ' live-token protocols';
      tableHost.appendChild(livePanel());
      return;
    }
    var list = sorted(visibleRows());
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' rows';
    if (list.length === 0) {
      tableHost.appendChild(el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('p', { text: 'No pre-token protocol matches those filters.' }),
        el('button', { type: 'button', text: 'Clear filters', onclick: function () {
          state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlistOnly = false; writeHash(); render();
        } })
      )));
      return;
    }
    var top = list.reduce(function (mx, r) { return Math.max(mx, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { tabindex: '0', 'aria-selected': state.selected === r.slug ? 'true' : 'false',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'rank num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'pname' },
          el('b', null, r.name, r.on_watchlist ? el('span', { class: 'badge', text: 'watchlist' }) : null),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unlisted') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.category_multiple.toFixed(2) + 'x' }),
        el('td', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / top) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )
      );
      tbody.appendChild(tr);
    });
    tableHost.appendChild(el('div', { class: 'panel' }, el('div', { class: 'table-scroll' },
      el('table', null,
        el('caption', { text: 'Pre-token protocols ranked by implied value. Select a row for its model breakdown and farm plan.' }),
        el('thead', null, el('tr', null,
          sortTh('implied', 'Rank'), sortTh('name', 'Protocol'), sortTh('tvl', 'TVL'), sortTh('growth', '7d'), sortTh('age', 'Age'), sortTh('multiple', 'Cat. multiple'), sortTh('implied', 'Implied value')
        )),
        tbody
      )
    )));
  }

  function livePanel() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + ((r.chains || []).slice(0, 3).join(', ') || 'chain unlisted') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.ratio === null ? 'n/a' : r.ratio.toFixed(2) + 'x' }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) })
      ));
    });
    return el('div', { class: 'panel' },
      el('p', { class: 'live-note', text: 'These protocols already trade, so their market cap is a fact, not a model. They are never ranked on the board; their market-cap-to-TVL ratios are the comparables each category multiple is built from.' }),
      el('div', { class: 'table-scroll' }, el('table', null,
        el('thead', null, el('tr', null,
          el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }), el('th', { scope: 'col', text: '7d' })
        )),
        tbody
      ))
    );
  }

  var detailHost = el('div');
  function openDetail(slug) {
    state.selected = slug;
    writeHash();
    renderDetail();
    renderTable();
  }
  function renderDetail() {
    detailHost.textContent = '';
    if (!state.selected) return;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return;
    var check = impliedOf(row);
    function cell(label, value) { return el('div', { class: 'cell' }, el('span', { text: label }), el('b', { class: 'num', text: value })); }
    var panel = el('section', { class: 'detail', id: 'detail' },
      el('div', { class: 'detail-head' },
        el('div', null,
          el('span', { class: 'num', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · on the watchlist' : ' · early row, below the floor') }),
          el('h2', null, row.name),
          el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + ((row.chains || []).join(', ') || 'an unlisted chain') + ' · tracked since ' + (row.listed_at || 'an unrecorded date') })
        ),
        el('button', { type: 'button', text: 'Close', onclick: function () { state.selected = null; writeHash(); renderDetail(); renderTable(); } })
      ),
      el('div', { class: 'detail-grid' },
        cell('TVL', fmtUsd(row.tvl_usd)),
        cell('7d TVL change', fmtPct(row.change_7d)),
        cell('Age with no token', fmtAge(row.age_days)),
        cell('Category multiple', row.category_multiple.toFixed(2) + 'x (' + row.comps_n + ' traded peers)'),
        cell('Momentum factor', row.momentum_multiplier.toFixed(2) + 'x'),
        cell('Track-record factor', row.track_multiplier.toFixed(2) + 'x'),
        cell('Implied value', fmtUsd(row.implied_value_usd))
      ),
      el('p', { class: 'note', text: 'Check the arithmetic: this page recomputes the row as ' + fmtUsd(check) + (check === row.implied_value_usd ? ', the same figure board.json carries.' : ', which differs from board.json: the data would be stale.') + ' The multiple is the median market-cap-to-TVL of the ' + (row.comps_n > 0 ? row.comps_n + ' traded protocols in its category' : 'whole market, its category has no traded peers') + ', shrunk toward the market median. An implied value is this model\u2019s claim about a launch priced against today\u2019s record, not a prediction that a token will exist.' }),
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, action, tail ? el('span', { class: 'tail', text: tail }) : null);
      }))
    );
    detailHost.appendChild(panel);
  }

  function render() {
    app.textContent = '';
    var wrap = el('div', { class: 'wrap' });
    wrap.appendChild(masthead());
    wrap.appendChild(stats());
    wrap.appendChild(modelStrip());
    wrap.appendChild(toolbar());
    tableHost = el('div');
    wrap.appendChild(tableHost);
    detailHost = el('div');
    wrap.appendChild(detailHost);
    wrap.appendChild(el('footer', { text: 'Implied value is a model\u2019s claim, never a promise and never a forecast of a launch. Protocols are described as recording no token in the snapshot; a record can lag a launch. Farm at your own risk: a position can lose its value and a points program can end unpaid.' }));
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
    renderTable();
    renderDetail();
  }

  readHash();
  render();
})();
