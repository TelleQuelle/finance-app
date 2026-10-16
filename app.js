/* ============================================================
   app.js — вся логика приложения: данные, экраны, ввод, статистика
   Данные хранятся в localStorage (ключ finapp_data_v1).
   ============================================================ */

'use strict';

/* ============================================================
   1. КОНСТАНТЫ И СОСТОЯНИЕ
   ============================================================ */

const LS_KEY = 'finapp_data_v1';     // основной ключ хранения
const LS_BACKUP = 'finapp_backup_v1'; // резервная копия перед импортом/стиранием

/* Палитра для кольцевой диаграммы */
const PALETTE = ['#FFC53D', '#3DDC97', '#5EC8F2', '#B79CFF', '#FF7A6B', '#F2A2C0', '#6BD5C8', '#E8D38A'];

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн',
  'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/* Структура по умолчанию: с ней сравнивается и дополняется сохранённое */
const DEFAULT_STATE = {
  version: 1,
  settings: { exportReminderShown: false, lastExportAt: null },
  categories: {
    personal: [
      { id: 'p_food',      name: 'Еда',        emoji: '🍔', type: 'expense' },
      { id: 'p_transport', name: 'Транспорт',  emoji: '🚌', type: 'expense' },
      { id: 'p_home',      name: 'Жильё',      emoji: '🏠', type: 'expense' },
      { id: 'p_fun',       name: 'Развлечения', emoji: '🎮', type: 'expense' },
      { id: 'p_health',    name: 'Здоровье',   emoji: '💊', type: 'expense' },
      { id: 'p_shopping',  name: 'Покупки',    emoji: '🛍️', type: 'expense' },
      { id: 'p_salary',    name: 'Зарплата',   emoji: '💼', type: 'income' },
      { id: 'p_other',     name: 'Прочее',     emoji: '📦', type: 'both' }
    ],
    business: [
      { id: 'b_income',   name: 'Выручка',  emoji: '🤝', type: 'income' },
      { id: 'b_ads',      name: 'Реклама',  emoji: '📣', type: 'expense' },
      { id: 'b_rent',     name: 'Аренда',   emoji: '🏢', type: 'expense' },
      { id: 'b_services', name: 'Сервисы',  emoji: '🖥️', type: 'expense' },
      { id: 'b_other',    name: 'Прочее',   emoji: '📦', type: 'both' }
    ]
  },
  personal: { operations: [] },
  business: { operations: [] },
  crypto: {
    assets: [
      { id: 'ton',  coingeckoId: 'the-open-network',      symbol: 'TON',  name: 'Toncoin', emoji: '💎' },
      { id: 'sol',  coingeckoId: 'solana',                symbol: 'SOL',  name: 'Solana',  emoji: '◎' },
      { id: 'jup',  coingeckoId: 'jupiter-exchange-solana', symbol: 'JUP', name: 'Jupiter', emoji: '🪐' },
      /* Если цена GRAM не придёт — проверьте/исправьте идентификатор в настройках активов */
      { id: 'gram', coingeckoId: 'gram',                  symbol: 'GRAM', name: 'Gram',    emoji: '💠' }
    ],
    operations: []
  },
  rates: { usdRub: null, crypto: {}, updatedAt: null, lastFetchAt: 0 }
};

let state = null;

/* ============================================================
   2. УТИЛИТЫ
   ============================================================ */

const $ = sel => document.querySelector(sel);

/* Уникальный идентификатор для новых записей */
function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* Экранирование пользовательских строк перед вставкой в HTML */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&', '<': '<', '>': '>', '"': '"', "'": ''' }[c]
  ));
}

/* Чтение CSS-переменной (для цветов графиков, чтобы они следовали теме) */
function getCss(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

/* --- Форматирование денег и чисел --- */
const moneyFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });

function fmtRub(n) { return moneyFmt.format(n) + ' ₽'; }
function fmtUsd(n) { return '$' + moneyFmt.format(n); }

/* Для дешёвых токенов нужны больше знаков после точки */
function fmtUsdSmart(n) {
  const dec = (Math.abs(n) >= 1) ? 2 : 6;
  return '$' + new Intl.NumberFormat('ru-RU', { maximumFractionDigits: dec }).format(n);
}
function fmtRubSmart(n) {
  if (Math.abs(n) >= 1) return fmtRub(n);
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n) + ' ₽';
}

/* Количество токена: до 8 знаков, лишние нули не показываем */
function fmtNum(n, maxDec = 8) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: maxDec }).format(n);
}

/* --- Даты --- */
function pad2(x) { return String(x).padStart(2, '0'); }

/* Текущий момент в формате datetime-local: 'YYYY-MM-DDTHH:mm' (локальное время) */
function nowLocalValue() {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
    + 'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

function monthKey(iso) { return String(iso).slice(0, 7); }

/* '16 окт, 19:30' */
function fmtDateShort(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return String(iso);
  return d.getDate() + ' ' + MONTHS_SHORT[d.getMonth()] + ', '
    + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* '16.10 23:40' — для строки «актуально на ...» */
function fmtStamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  return pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + ' '
    + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

/* --- Анимация числа (однократная, уважает reduced motion) --- */
function animateNumber(el, from, to, format) {
  const reduce = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce || from === to) { el.textContent = format(to); return; }
  const dur = 700;
  const t0 = performance.now();
  function step(t) {
    const k = Math.min(1, (t - t0) / dur);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = format(from + (to - from) * eased);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ============================================================
   3. ЗАГРУЗКА / СОХРАНЕНИЕ ДАННЫХ
   ============================================================ */

/* Аккуратное слияние сохранённых данных с дефолтной структурой:
   недостающие поля добираются из DEFAULT_STATE, лишние — сохраняются */
function deepMerge(base, saved) {
  if (saved === undefined || saved === null) return structuredClone(base);
  if (base === null || typeof base !== 'object') return saved;
  if (Array.isArray(base)) return Array.isArray(saved) ? saved : structuredClone(base);
  const out = structuredClone(base);
  if (typeof saved === 'object' && saved !== null) {
    for (const k of Object.keys(base)) out[k] = deepMerge(base[k], saved[k]);
    for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
  }
  return out;
}

function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      state = deepMerge(DEFAULT_STATE, JSON.parse(raw));
    } else {
      state = structuredClone(DEFAULT_STATE);
      saveState();
    }
  } catch (e) {
    /* Повреждённые данные — начинаем с чистой структуры, но старую копию не удаляем */
    state = structuredClone(DEFAULT_STATE);
    saveState();
  }
}

/* Автосохранение после каждого изменения данных */
function saveState() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch (e) {
    toast('Не удалось сохранить данные в память браузера', true);
  }
}

function findCat(scope, id) {
  return state.categories[scope].find(c => c.id === id) || null;
}

/* ============================================================
   4. TELEGRAM WEB APP (в браузере всё тихо отключается)
   ============================================================ */

const TG = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
let mainBtnHandler = null;

function initTelegram() {
  if (!TG) return;
  try {
    TG.ready();
    TG.expand();
    try {
      TG.setHeaderColor('#0D1B24');
      TG.setBackgroundColor('#0D1B24');
    } catch (e) { /* старые клиенты не умеют — не критично */ }
    /* Если у пользователя в Telegram светлая тема — переключаем светлую палитру */
    if (TG.colorScheme === 'light') document.body.classList.add('light');
  } catch (e) { /* игнорируем */ }
}

function hapticSelect() { try { TG && TG.HapticFeedback && TG.HapticFeedback.selectionChanged(); } catch (e) {} }
function hapticTap()    { try { TG && TG.HapticFeedback && TG.HapticFeedback.impactOccurred('light'); } catch (e) {} }
function hapticNotify(type) { try { TG && TG.HapticFeedback && TG.HapticFeedback.notificationOccurred(type); } catch (e) {} }

/* Main Button Telegram дублирует кнопку «Сохранить» внизу экрана */
function showMainButton(text, fn) {
  if (!TG || !TG.MainButton) return;
  try {
    if (mainBtnHandler) TG.MainButton.offClick(mainBtnHandler);
    mainBtnHandler = fn;
    TG.MainButton.setText(text);
    TG.MainButton.setParams({ color: '#FFC53D', text_color: '#241A02' });
    TG.MainButton.onClick(fn);
    TG.MainButton.show();
  } catch (e) { /* в браузере не выполняется */ }
}

function hideMainButton() {
  if (!TG || !TG.MainButton) return;
  try {
    if (mainBtnHandler) TG.MainButton.offClick(mainBtnHandler);
    mainBtnHandler = null;
    TG.MainButton.hide();
  } catch (e) { /* игнорируем */ }
}

/* ============================================================
   5. РАСЧЁТЫ: БАЛАНСЫ И КРИПТО-ПОРТФЕЛЬ
   ============================================================ */

function balanceOf(ops) {
  let s = 0;
  for (const o of ops) s += (o.type === 'income') ? o.amount : -o.amount;
  return s;
}

/* Портфель по каждому активу: количество, средняя цена покупки, P/L */
function cryptoPortfolio() {
  return state.crypto.assets.map(asset => {
    const ops = state.crypto.operations.filter(o => o.assetId === asset.id);
    let qty = 0, addQty = 0, addCost = 0;
    for (const o of ops) {
      if (o.type === 'add') {
        qty += o.amount;
        addQty += o.amount;
        addCost += o.amount * o.priceUsd;
      } else {
        qty -= o.amount;
      }
    }
    qty = Math.round(qty * 1e8) / 1e8;
    const avgUsd = addQty > 0 ? addCost / addQty : null;
    const price = Rates.getPrice(asset.id);
    const curUsd = price ? price.usd : null;
    const curRub = price ? price.rub : null;
    const valueUsd = (qty > 0) ? (curUsd !== null ? qty * curUsd : null) : 0;
    const valueRub = (qty > 0) ? (curRub !== null ? qty * curRub : null) : 0;
    let plUsd = null, plPct = null;
    if (avgUsd !== null && curUsd !== null && qty !== 0) {
      plUsd = qty * (curUsd - avgUsd);
      plPct = avgUsd > 0 ? ((curUsd - avgUsd) / avgUsd) * 100 : null;
    }
    return { asset, qty, avgUsd, curUsd, curRub, valueUsd, valueRub, plUsd, plPct };
  });
}

function cryptoTotals() {
  let usd = 0, rub = 0;
  for (const p of cryptoPortfolio()) {
    if (p.valueUsd !== null) usd += p.valueUsd;
    if (p.valueRub !== null) rub += p.valueRub;
  }
  return { usd, rub };
}

/* Строка «актуально на …, $1 = … ₽» */
function ratesLineText() {
  if (!state.rates.updatedAt) return 'Котировки ещё не получены';
  let line = 'Актуально на ' + fmtStamp(state.rates.updatedAt);
  if (state.rates.usdRub) line += ', $1 = ' + fmtNum(state.rates.usdRub, 2) + ' ₽';
  return line;
}

/* ============================================================
   6. РОУТЕР ЭКРАНОВ
   ============================================================ */

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  document.querySelectorAll('.tabbar .tab').forEach(t => t.classList.toggle('active', t.dataset.screen === id));
  window.scrollTo(0, 0);
  /* Перерисовываем экран при входе — данные могли измениться */
  if (id === 'screen-home') renderHome();
  if (id === 'screen-history') renderHistory();
  if (id === 'screen-crypto') renderCrypto();
  if (id === 'screen-stats') renderStats();
  if (id === 'screen-settings') renderSettings();
}

/* Полное обновление всех экранов после изменения данных */
function refreshAfterDataChange() {
  renderHome();
  renderHistory();
  renderCrypto();
  renderSettings();
  const active = document.querySelector('.screen.active');
  if (active && active.id === 'screen-stats') renderStats();
}

/* ============================================================
   7. ЭКРАН: ГЛАВНАЯ
   ============================================================ */

let lastTotalShown = null;

function renderHome() {
  const b  = balanceOf(state.personal.operations);
  const bb = balanceOf(state.business.operations);
  const ct = cryptoTotals();
  const total = b + bb + ct.rub;

  /* Баннер-напоминание про экспорт: виден до первого экспорта */
  $('#export-banner').classList.toggle('hidden', !!state.settings.exportReminderShown);

  /* Большой баланс с однократной анимацией накопления */
  const totalEl = $('#home-total');
  animateNumber(totalEl, lastTotalShown === null ? total : lastTotalShown, total, fmtRub);
  lastTotalShown = total;

  $('#home-personal').textContent = fmtRub(b);
  $('#home-business').textContent = fmtRub(bb);
  $('#home-crypto').textContent = fmtRub(ct.rub);

  /* Доходы и расходы за текущий месяц (личный счёт) */
  const mk = monthKey(nowLocalValue());
  let inc = 0, exp = 0;
  for (const o of state.personal.operations) {
    if (monthKey(o.date) === mk) {
      if (o.type === 'income') inc += o.amount; else exp += o.amount;
    }
  }
  $('#home-inc').textContent = '+' + fmtRub(inc);
  $('#home-exp').textContent = '−' + fmtRub(exp);

  $('#home-rates-line').textContent = ratesLineText();

  /* Последние 5 операций всех типов */
  const all = [
    ...state.personal.operations.map(o => ({ ...o, scope: 'personal' })),
    ...state.business.operations.map(o => ({ ...o, scope: 'business' })),
    ...state.crypto.operations.map(o => ({ ...o, crypto: true }))
  ].sort((a, b) => b.date.localeCompare(a.date));

  const last = all.slice(0, 5);
  $('#home-last-ops').innerHTML = last.length
    ? last.map(opRowHTML).join('')
    : '<div class="empty">Пока нет операций — нажмите «+» справа внизу</div>';
}

/* Строка операции (фиат или крипта) — используется на главной и в истории */
function opRowHTML(o) {
  if (o.crypto) {
    const a = state.crypto.assets.find(x => x.id === o.assetId);
    const sym = a ? a.symbol : '???';
    const emoji = a ? a.emoji : '💠';
    const sign = o.type === 'add' ? '+' : '−';
    const title = (a ? a.name : sym) + ' · ' + (o.type === 'add' ? 'добавил' : 'списал');
    return '<div class="op-row" data-crypto-id="' + esc(o.id) + '">'
      + '<div class="op-emoji">' + esc(emoji) + '</div>'
      + '<div class="op-main"><div class="op-title">' + esc(title) + '</div>'
      + '<div class="op-sub">' + esc(fmtDateShort(o.date)) + ' · ' + fmtNum(o.amount) + ' ' + esc(sym)
      + ' · ' + fmtUsdSmart(o.totalUsd) + '</div></div>'
      + '<div class="op-amount ' + (o.type === 'add' ? 'pos' : '') + '">' + sign + fmtRub(o.totalRub) + '</div>'
      + '</div>';
  }
  const cat = findCat(o.scope, o.categoryId);
  const emoji = cat ? cat.emoji : '❔';
  const name = cat ? cat.name : 'Без категории';
  const sign = o.type === 'income' ? '+' : '−';
  const scopeLabel = o.scope === 'business' ? 'Корп.' : 'Личные';
  return '<div class="op-row" data-op-id="' + esc(o.id) + '" data-op-scope="' + esc(o.scope) + '">'
    + '<div class="op-emoji">' + esc(emoji) + '</div>'
    + '<div class="op-main"><div class="op-title">' + esc(name)
    + (o.comment ? ' · ' + esc(o.comment) : '') + '</div>'
    + '<div class="op-sub">' + esc(fmtDateShort(o.date)) + ' · ' + scopeLabel + '</div></div>'
    + '<div class="op-amount ' + (o.type === 'income' ? 'pos' : '') + '">' + sign + fmtRub(o.amount) + '</div>'
    + '</div>';
}

/* ============================================================
   8. ЭКРАН: ИСТОРИЯ (ЛИЧНЫЕ / КОРПОРАТИВНЫЕ)
   ============================================================ */

let histScope = 'personal';
let histMonth = 'all';

function renderHistory() {
  $('#hist-scope [data-scope="personal"]').classList.toggle('active', histScope === 'personal');
  $('#hist-scope [data-scope="business"]').classList.toggle('active', histScope === 'business');

  const ops = state[histScope].operations;

  /* Список месяцев, в которых есть операции */
  const months = [...new Set(ops.map(o => monthKey(o.date)))].sort().reverse();
  const sel = $('#hist-month');
  sel.innerHTML = '<option value="all">Все время</option>' + months.map(m => {
    const parts = m.split('-');
    return '<option value="' + m + '">' + MONTHS[+parts[1] - 1] + ' ' + parts[0] + '</option>';
  }).join('');
  if (histMonth !== 'all' && !months.includes(histMonth)) histMonth = 'all';
  sel.value = histMonth;

  $('#hist-balance').textContent = fmtRub(balanceOf(ops));

  const list = ops
    .filter(o => histMonth === 'all' || monthKey(o.date) === histMonth)
    .sort((a, b) => b.date.localeCompare(a.date));

  $('#hist-list').innerHTML = list.length
    ? list.map(o => opRowHTML({ ...o, scope: histScope })).join('')
    : '<div class="empty">Операций нет</div>';
}

/* ============================================================
   9. ЭКРАН: КРИПТА
   ============================================================ */

function renderCrypto() {
  const port = cryptoPortfolio();
  const tot = cryptoTotals();

  $('#crypto-total-usd').textContent = fmtUsd(tot.usd);
  $('#crypto-total-rub').textContent = fmtRub(tot.rub);
  $('#crypto-rates-line').textContent = ratesLineText();

  /* Карточки активов */
  $('#crypto-assets').innerHTML = port.map(p => {
    const a = p.asset;
    const priceLine = p.curUsd !== null
      ? fmtUsdSmart(p.curUsd) + ' · ' + fmtRubSmart(p.curRub)
      : 'цена недоступна — проверьте идентификатор в настройках';
    const avgLine = p.avgUsd !== null ? 'средняя ' + fmtUsdSmart(p.avgUsd) : 'нет покупок';
    const valueLine = p.valueUsd !== null
      ? fmtUsdSmart(p.valueUsd) + '<small>' + fmtRubSmart(p.valueRub) + '</small>'
      : '—';

    let plHTML = '';
    if (p.qty === 0) {
      plHTML = '<div class="asset-pl none">Количество: 0</div>';
    } else if (p.plPct !== null) {
      const cls = p.plUsd >= 0 ? 'pos' : 'neg';
      const sign = p.plUsd >= 0 ? '+' : '−';
      plHTML = '<div class="asset-pl ' + cls + '">'
        + (p.plPct >= 0 ? '+' : '−') + fmtNum(Math.abs(p.plPct), 2) + '% · '
        + sign + fmtUsdSmart(Math.abs(p.plUsd)) + '</div>';
    } else {
      plHTML = '<div class="asset-pl none">Прибыльность неизвестна — нет текущей цены</div>';
    }

    return '<div class="asset-card">'
      + '<div class="asset-head">'
      + '<div class="op-emoji">' + esc(a.emoji) + '</div>'
      + '<div class="op-main"><div class="op-title">' + esc(a.name) + '</div>'
      + '<div class="op-sub">' + fmtNum(p.qty) + ' ' + esc(a.symbol) + ' · ' + esc(avgLine) + '</div>'
      + '<div class="op-sub">' + esc(priceLine) + '</div></div>'
      + '<div class="asset-value">' + valueLine + '</div>'
      + '</div>' + plHTML + '</div>';
  }).join('');

  /* История крипто-операций с зафиксированными ценами */
  const ops = state.crypto.operations.slice().sort((a, b) => b.date.localeCompare(a.date));
  $('#crypto-ops').innerHTML = ops.length
    ? ops.map(cryptoOpRowHTML).join('')
    : '<div class="empty">Крипто-операций пока нет</div>';
}

function cryptoOpRowHTML(o) {
  const a = state.crypto.assets.find(x => x.id === o.assetId);
  const sym = a ? a.symbol : '???';
  const emoji = a ? a.emoji : '💠';
  const sign = o.type === 'add' ? '+' : '−';
  return '<div class="op-row" data-crypto-id="' + esc(o.id) + '">'
    + '<div class="op-emoji">' + esc(emoji) + '</div>'
    + '<div class="op-main">'
    + '<div class="op-title">' + (o.type === 'add' ? 'Добавил' : 'Списал') + ' '
    + fmtNum(o.amount) + ' ' + esc(sym) + '</div>'
    + '<div class="op-sub">' + esc(fmtDateShort(o.date)) + ' · цена '
    + fmtUsdSmart(o.priceUsd) + ' / ' + fmtRubSmart(o.priceRub) + ' · сумма '
    + fmtUsdSmart(o.totalUsd) + '</div>'
    + (o.comment ? '<div class="op-sub">' + esc(o.comment) + '</div>' : '')
    + '</div>'
    + '<div class="op-amount ' + (o.type === 'add' ? 'pos' : '') + '">' + sign + fmtRub(o.totalRub) + '</div>'
    + '</div>';
}

/* ============================================================
   10. ЭКРАН: СТАТИСТИКА
   ============================================================ */

let statScope = 'personal';
let statPeriod = 'month';
let doughnutChart = null;
let monthsChart = null;

/* Начало выбранного периода (null = всё время) */
function periodStart() {
  const now = new Date();
  if (statPeriod === 'month') {
    return now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-01T00:00';
  }
  if (statPeriod === '3m') {
    const d = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01T00:00';
  }
  if (statPeriod === 'year') {
    return now.getFullYear() + '-01-01T00:00';
  }
  return null;
}

/* Список последних N месяцев в виде 'YYYY-MM' */
function monthKeysBack(n) {
  const out = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1));
  }
  return out;
}

function renderStats() {
  $('#stat-scope [data-scope="personal"]').classList.toggle('active', statScope === 'personal');
  $('#stat-scope [data-scope="business"]').classList.toggle('active', statScope === 'business');
  document.querySelectorAll('#stat-period .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.period === statPeriod));

  const start = periodStart();
  const ops = state[statScope].operations.filter(o => !start || o.date >= start);

  /* --- Расходы по категориям --- */
  const byCat = {};
  for (const o of ops) {
    if (o.type === 'expense') byCat[o.categoryId] = (byCat[o.categoryId] || 0) + o.amount;
  }
  const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);

  if (doughnutChart) { doughnutChart.destroy(); doughnutChart = null; }
  if (monthsChart) { monthsChart.destroy(); monthsChart = null; }

  const dEmpty = $('#doughnut-empty');
  const dCanvas = $('#chart-doughnut');

  if (!entries.length || !window.Chart) {
    dCanvas.classList.add('hidden');
    dEmpty.classList.toggle('hidden', entries.length > 0);
    dEmpty.textContent = window.Chart
      ? 'Нет расходов за выбранный период'
      : 'Графики недоступны — не загрузилась библиотека Chart.js (проверьте сеть)';
  } else {
    dCanvas.classList.remove('hidden');
    dEmpty.classList.add('hidden');
    doughnutChart = new Chart(dCanvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: entries.map(([id]) => {
          const c = findCat(statScope, id);
          return c ? c.name : 'Без категории';
        }),
        datasets: [{
          data: entries.map(([, v]) => v),
          backgroundColor: PALETTE,
          borderColor: getCss('--surface') || '#152631',
          borderWidth: 2
        }]
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: getCss('--muted') || '#8FA9B5', boxWidth: 10, font: { size: 11 } }
          }
        }
      }
    });
  }

  /* --- Столбчатый график по месяцам --- */
  const mEmpty = $('#months-empty');
  const mCanvas = $('#chart-months');
  const monthCount = statPeriod === 'year' ? 12 : (statPeriod === 'all' ? 24 : 6);

  let keys;
  if (statPeriod === 'all') {
    const present = [...new Set(ops.map(o => monthKey(o.date)))].sort();
    keys = present.slice(-monthCount);
    if (!keys.length) keys = monthKeysBack(6);
  } else {
    keys = monthKeysBack(monthCount);
  }

  const incData = [], expData = [];
  for (const k of keys) {
    let i = 0, e = 0;
    for (const o of ops) {
      if (monthKey(o.date) !== k) continue;
      if (o.type === 'income') i += o.amount; else e += o.amount;
    }
    incData.push(i);
    expData.push(e);
  }

  const hasAny = incData.some(v => v > 0) || expData.some(v => v > 0);
  const nowYear = new Date().getFullYear();

  if (!hasAny || !window.Chart) {
    mCanvas.classList.add('hidden');
    mEmpty.classList.toggle('hidden', hasAny);
    mEmpty.textContent = window.Chart
      ? 'Нет данных за выбранный период'
      : 'Графики недоступны — не загрузилась библиотека Chart.js';
  } else {
    mCanvas.classList.remove('hidden');
    mEmpty.classList.add('hidden');
    const labels = keys.map(k => {
      const parts = k.split('-');
      const label = MONTHS_SHORT[+parts[1] - 1];
      return +parts[0] !== nowYear ? label + " '" + parts[0].slice(2) : label;
    });
    monthsChart = new Chart(mCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Доходы', data: incData, backgroundColor: getCss('--pos') || '#3DDC97', borderRadius: 5, maxBarThickness: 18 },
          { label: 'Расходы', data: expData, backgroundColor: getCss('--neg') || '#FF7A6B', borderRadius: 5, maxBarThickness: 18 }
        ]
      },
      options: {
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: getCss('--muted') || '#8FA9B5', boxWidth: 10, font: { size: 11 } }
          }
        },
        scales: {
          x: { ticks: { color: getCss('--muted') || '#8FA9B5' }, grid: { display: false } },
          y: {
            ticks: {
              color: getCss('--muted') || '#8FA9B5',
              callback: v => new Intl.NumberFormat('ru-RU', { notation: 'compact' }).format(v)
            },
            grid: { color: getCss('--line') || '#24404F' },
            border: { display: false }
          }
        }
      }
    });
  }

  /* --- Топ-5 категорий по тратам --- */
  const sumAll = entries.reduce((s, [, v]) => s + v, 0);
  const top = entries.slice(0, 5);
  $('#stat-top').innerHTML = top.length
    ? top.map(([id, v]) => {
        const c = findCat(statScope, id);
        const share = sumAll > 0 ? (v / sumAll) * 100 : 0;
        return '<div class="top-row">'
          + '<div class="top-line"><span>' + esc(c ? c.emoji + ' ' + c.name : '❔ Без категории') + '</span>'
          + '<span><b>' + fmtRub(v) + '</b> <span class="share">' + fmtNum(share, 1) + '%</span></span></div>'
          + '<div class="top-bar"><i style="width:' + Math.min(100, share) + '%"></i></div>'
          + '</div>';
      }).join('')
    : '<div class="empty">Нет трат за период</div>';

  /* --- Крипто-портфель отдельно --- */
  const ct = cryptoTotals();
  const port = cryptoPortfolio();
  $('#stat-crypto').innerHTML =
    '<div class="balance-strip" style="margin-bottom:10px">'
    + '<span>Всего</span><b>' + fmtUsd(ct.usd) + ' · ' + fmtRub(ct.rub) + '</b></div>'
    + port.filter(p => p.qty !== 0).map(p =>
        '<div class="top-row"><div class="top-line">'
        + '<span>' + esc(p.asset.emoji + ' ' + p.asset.symbol) + '</span>'
        + '<span><b>' + (p.valueUsd !== null ? fmtUsdSmart(p.valueUsd) : '—') + '</b></span>'
        + '</div></div>'
      ).join('')
    + (port.every(p => p.qty === 0) ? '<div class="empty">Крипто-активов нет</div>' : '');
}

/* ============================================================
   11. ЭКРАН: НАСТРОЙКИ (экспорт, категории, активы)
   ============================================================ */

function catTypeLabel(t) {
  return t === 'income' ? 'Доход' : (t === 'both' ? 'Расход и доход' : 'Расход');
}

function renderSettings() {
  $('#last-export').textContent = state.settings.lastExportAt
    ? 'Последний экспорт: ' + fmtDateShort(state.settings.lastExportAt)
    : 'Экспорт ещё не делался';

  renderCatList('personal');
  renderCatList('business');
  renderAssetList();
}

function renderCatList(scope) {
  const box = $('#cats-' + scope);
  box.innerHTML = state.categories[scope].map(c =>
    '<button class="cat-row" data-cat-scope="' + scope + '" data-cat-id="' + esc(c.id) + '">'
    + '<span class="op-emoji">' + esc(c.emoji) + '</span>'
    + '<span class="op-main"><span class="op-title">' + esc(c.name) + '</span>'
    + '<div class="op-sub">' + catTypeLabel(c.type) + '</div></span>'
    + '<span class="row-hint">Изменить</span>'
    + '</button>'
  ).join('');
}

function renderAssetList() {
  $('#assets-settings').innerHTML = state.crypto.assets.map(a =>
    '<button class="asset-row" data-asset-id="' + esc(a.id) + '">'
    + '<span class="op-emoji">' + esc(a.emoji) + '</span>'
    + '<span class="op-main"><span class="op-title">' + esc(a.name) + ' (' + esc(a.symbol) + ')</span>'
    + '<div class="op-sub asset-id">CoinGecko: ' + esc(a.coingeckoId || '—') + '</div></span>'
    + '<span class="row-hint">Изменить</span>'
    + '</button>'
  ).join('');
}

/* ============================================================
   12. МОДАЛКА: ФИАТНАЯ ОПЕРАЦИЯ
   ============================================================ */

const opSt = {
  scope: 'personal',    // personal | business
  type: 'expense',      // expense | income
  amountStr: '',        // то, что набрано на клавиатуре
  categoryId: null,
  editId: null,
  origScope: null       // исходный счёт при редактировании
};

function openOpModal(opts = {}) {
  opSt.editId = opts.editId || null;
  opSt.scope = opts.scope || 'personal';
  opSt.origScope = opSt.editId ? opSt.scope : null;
  opSt.type = 'expense';
  opSt.amountStr = '';
  opSt.categoryId = null;

  if (opSt.editId) {
    const o = state[opSt.scope].operations.find(x => x.id === opSt.editId);
    if (o) {
      opSt.type = o.type;
      opSt.amountStr = String(o.amount);
      opSt.categoryId = o.categoryId;
      $('#op-date').value = o.date;
      $('#op-comment').value = o.comment || '';
    }
    $('#op-title').textContent = 'Изменить операцию';
    $('#op-delete').classList.remove('hidden');
  } else {
    $('#op-date').value = nowLocalValue();
    $('#op-comment').value = '';
    $('#op-title').textContent = 'Новая операция';
    $('#op-delete').classList.add('hidden');
  }

  syncOpUI();
  openModal('modal-op');
  showMainButton('Сохранить', saveOp);
}

function syncOpUI() {
  document.querySelectorAll('#op-scope .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.scope === opSt.scope));
  const tE = $('#op-type [data-type="expense"]');
  const tI = $('#op-type [data-type="income"]');
  tE.classList.toggle('active', opSt.type === 'expense');
  tI.classList.toggle('active', opSt.type === 'income');
  tE.classList.toggle('neg', opSt.type === 'expense');
  tI.classList.toggle('pos', opSt.type === 'income');

  $('#op-amount-display').textContent = opSt.amountStr === '' ? '0' : opSt.amountStr;
  renderOpCats();
}

function renderOpCats() {
  const cats = state.categories[opSt.scope]
    .filter(c => c.type === opSt.type || c.type === 'both');
  $('#op-cats').innerHTML = cats.length
    ? cats.map(c =>
        '<button class="chip ' + (opSt.categoryId === c.id ? 'active' : '')
        + '" data-cat-id="' + esc(c.id) + '">' + esc(c.emoji) + ' ' + esc(c.name) + '</button>'
      ).join('')
    : '<span class="empty-inline">Нет подходящих категорий — добавьте их в настройках</span>';
}

function saveOp() {
  const amount = parseFloat(opSt.amountStr.replace(',', '.'));
  if (!isFinite(amount) || amount <= 0) {
    toast('Введите сумму больше нуля', true); hapticNotify('error'); return;
  }
  if (!opSt.categoryId) {
    toast('Выберите категорию', true); hapticNotify('error'); return;
  }
  const dateVal = $('#op-date').value;
  if (!dateVal) { toast('Укажите дату', true); return; }
  const comment = $('#op-comment').value.trim().slice(0, 200);

  const rec = {
    id: opSt.editId || uid('op'),
    type: opSt.type,
    amount: Math.round(amount * 100) / 100,
    categoryId: opSt.categoryId,
    date: dateVal,
    comment
  };

  if (opSt.editId) {
    /* При смене счёта операция переезжает из одного списка в другой */
    if (opSt.origScope !== opSt.scope) {
      state[opSt.origScope].operations = state[opSt.origScope].operations.filter(x => x.id !== rec.id);
      state[opSt.scope].operations.push(rec);
    } else {
      const idx = state[opSt.scope].operations.findIndex(x => x.id === rec.id);
      if (idx >= 0) state[opSt.scope].operations[idx] = rec;
      else state[opSt.scope].operations.push(rec);
    }
  } else {
    state[opSt.scope].operations.push(rec);
  }

  saveState();
  hapticNotify('success');
  closeModal('modal-op');
  refreshAfterDataChange();
}

function deleteOp() {
  const o = state[opSt.scope].operations.find(x => x.id === opSt.editId);
  if (!o) return;
  if (!confirm('Удалить эту операцию?')) return;
  state[opSt.scope].operations = state[opSt.scope].operations.filter(x => x.id !== opSt.editId);
  saveState();
  hapticNotify('warning');
  closeModal('modal-op');
  refreshAfterDataChange();
  toast('Операция удалена');
}

/* ============================================================
   13. МОДАЛКА: КРИПТО-ОПЕРАЦИЯ
   ============================================================ */

const crSt = {
  assetId: null,
  type: 'add',       // add | remove
  amountStr: '',
  editId: null
};

function openCryptoModal(opts = {}) {
  crSt.editId = opts.editId || null;
  crSt.type = 'add';
  crSt.amountStr = '';
  crSt.assetId = state.crypto.assets.length ? state.crypto.assets[0].id : null;

  if (crSt.editId) {
    const o = state.crypto.operations.find(x => x.id === crSt.editId);
    if (o) {
      crSt.assetId = o.assetId;
      crSt.type = o.type;
      crSt.amountStr = String(o.amount);
      $('#cr-date').value = o.date;
      $('#cr-comment').value = o.comment || '';
    }
    $('#cr-title').textContent = 'Изменить операцию';
    $('#cr-delete').classList.remove('hidden');
  } else {
    $('#cr-date').value = nowLocalValue();
    $('#cr-comment').value = '';
    $('#cr-title').textContent = 'Новая крипто-операция';
    $('#cr-delete').classList.add('hidden');
  }

  syncCrUI();
  openModal('modal-crypto');
  showMainButton('Сохранить', saveCryptoOp);
}

function syncCrUI() {
  /* При редактировании актив менять нельзя — цена зафиксирована под старый актив */
  $('#cr-assets').innerHTML = state.crypto.assets.map(a =>
    '<button class="chip ' + (crSt.assetId === a.id ? 'active' : '')
    + '" data-asset-id="' + esc(a.id) + '"' + (crSt.editId ? ' disabled' : '') + '>'
    + esc(a.emoji) + ' ' + esc(a.symbol) + '</button>'
  ).join('') || '<span class="empty-inline">Сначала добавьте актив в настройках</span>';

  document.querySelectorAll('#cr-type .seg-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.type === crSt.type));

  $('#cr-amount-display').textContent = crSt.amountStr === '' ? '0' : crSt.amountStr;
  updateCrHint();
}

/* Подсказка: какая цена будет зафиксирована при сохранении */
function updateCrHint() {
  const el = $('#cr-price-hint');
  const a = state.crypto.assets.find(x => x.id === crSt.assetId);
  if (!a) { el.textContent = 'Сначала добавьте актив в настройках'; return; }

  if (crSt.editId) {
    const o = state.crypto.operations.find(x => x.id === crSt.editId);
    if (o) {
      el.textContent = 'Цена зафиксирована: ' + fmtUsdSmart(o.priceUsd) + ' / '
        + fmtRubSmart(o.priceRub) + ' за ' + a.symbol;
    }
    return;
  }

  const price = Rates.getPrice(a.id);
  if (!price) {
    el.textContent = 'Цена ' + a.symbol + ' недоступна — обновите котировки при наличии сети';
    return;
  }
  const amt = parseFloat(crSt.amountStr.replace(',', '.')) || 0;
  el.textContent = 'Будет зафиксировано: ' + fmtUsdSmart(price.usd) + ' / '
    + fmtRubSmart(price.rub) + ' за ' + a.symbol
    + (amt > 0 ? ' → ' + fmtUsdSmart(amt * price.usd) + ' / ' + fmtRubSmart(amt * price.rub) : '');
}

function saveCryptoOp() {
  const a = state.crypto.assets.find(x => x.id === crSt.assetId);
  if (!a) { toast('Выберите актив', true); return; }

  const amount = parseFloat(crSt.amountStr.replace(',', '.'));
  if (!isFinite(amount) || amount <= 0) {
    toast('Введите количество больше нуля', true); hapticNotify('error'); return;
  }
  const dateVal = $('#cr-date').value;
  if (!dateVal) { toast('Укажите дату', true); return; }

  /* Списание не может превышать остаток (без учёта редактируемой операции) */
  const opsForAsset = state.crypto.operations
    .filter(o => o.assetId === a.id && o.id !== crSt.editId);
  let qty = 0;
  for (const o of opsForAsset) qty += (o.type === 'add') ? o.amount : -o.amount;
  if (crSt.type === 'remove' && amount > qty + 1e-9) {
    toast('Списание больше остатка (' + fmtNum(Math.max(qty, 0)) + ' ' + a.symbol + ')', true);
    hapticNotify('error');
    return;
  }

  let priceUsd, priceRub, usdRub;
  if (crSt.editId) {
    /* Цена остаётся той же, что была зафиксирована при создании */
    const o = state.crypto.operations.find(x => x.id === crSt.editId);
    priceUsd = o.priceUsd;
    priceRub = o.priceRub;
    usdRub = o.usdRub;
  } else {
    const price = Rates.getPrice(a.id);
    if (!price) {
      toast('Нет цены для ' + a.symbol + '. Обновите котировки при наличии сети', true);
      hapticNotify('error');
      return;
    }
    priceUsd = price.usd;
    priceRub = price.rub;
    usdRub = (state.rates.usdRub && state.rates.usdRub > 0)
      ? state.rates.usdRub
      : (price.usd > 0 ? price.rub / price.usd : null);
  }

  const rec = {
    id: crSt.editId || uid('cop'),
    assetId: a.id,
    type: crSt.type,
    amount,
    date: dateVal,
    comment: $('#cr-comment').value.trim().slice(0, 200),
    priceUsd,
    priceRub,
    usdRub,
    totalUsd: Math.round(amount * priceUsd * 100) / 100,
    totalRub: Math.round(amount * priceRub * 100) / 100
  };

  if (crSt.editId) {
    const idx = state.crypto.operations.findIndex(x => x.id === rec.id);
    if (idx >= 0) state.crypto.operations[idx] = rec;
    else state.crypto.operations.push(rec);
  } else {
    state.crypto.operations.push(rec);
  }

  saveState();
  hapticNotify('success');
  closeModal('modal-crypto');
  refreshAfterDataChange();
  toast('Цена зафиксирована: ' + fmtUsdSmart(rec.priceUsd) + ' / ' + fmtRubSmart(rec.priceRub));
}

function deleteCryptoOp() {
  if (!confirm('Удалить эту крипто-операцию?')) return;
  state.crypto.operations = state.crypto.operations.filter(x => x.id !== crSt.editId);
  saveState();
  hapticNotify('warning');
  closeModal('modal-crypto');
  refreshAfterDataChange();
  toast('Операция удалена');
}

/* ============================================================
   14. ЦИФРОВАЯ КЛАВИАТУРА
   ============================================================ */

function buildKeypad(el) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
  el.innerHTML = keys.map(k =>
    '<button class="key" data-key="' + k + '" type="button">' + (k === '⌫' ? '⌫' : k) + '</button>'
  ).join('');
}

/*
 * Обработка нажатия: st — состояние ввода, maxDec — максимум знаков после точки
 * (2 для рублей, 8 для крипты)
 */
function pressKey(k, st, maxDec) {
  if (k === '⌫') {
    st.amountStr = st.amountStr.slice(0, -1);
    return;
  }
  if (k === '.') {
    if (st.amountStr.includes('.')) return;
    st.amountStr = st.amountStr === '' ? '0.' : st.amountStr + '.';
    return;
  }
  const parts = st.amountStr.split('.');
  if (parts[0].length >= 12) return;                       // ограничение целой части
  if (parts.length === 2 && parts[1].length >= maxDec) return; // ограничение дробной части
  if (st.amountStr === '0') st.amountStr = k;
  else st.amountStr += k;
}

/* ============================================================
   15. МОДАЛКА: КАТЕГОРИЯ
   ============================================================ */

const CAT_EMOJI_PRESETS = ['🍔', '🚌', '🏠', '🎮', '💊', '🛍️', '💼', '📦', '✈️', '🎁', '☕', '🐶'];
let catEdit = { scope: null, id: null };

function openCatModal(scope, id) {
  catEdit = { scope, id };
  const c = id ? state.categories[scope].find(x => x.id === id) : null;
  $('#cat-title').textContent = c ? 'Изменить категорию' : 'Новая категория';
  $('#cat-emoji').value = c ? c.emoji : '🏷️';
  $('#cat-name').value = c ? c.name : '';
  $('#cat-type').value = c ? c.type : 'expense';
  $('#cat-delete').classList.toggle('hidden', !c);
  $('#cat-emoji-presets').innerHTML = CAT_EMOJI_PRESETS.map(e =>
    '<button class="chip" data-emoji="' + e + '" type="button">' + e + '</button>'
  ).join('');
  openModal('modal-cat');
}

function saveCat() {
  const emoji = $('#cat-emoji').value.trim() || '🏷️';
  const name = $('#cat-name').value.trim();
  if (!name) { toast('Введите название категории', true); return; }
  const type = $('#cat-type').value;

  if (catEdit.id) {
    const c = state.categories[catEdit.scope].find(x => x.id === catEdit.id);
    if (c) { c.emoji = emoji; c.name = name; c.type = type; }
  } else {
    state.categories[catEdit.scope].push({ id: uid('cat'), name, emoji, type });
  }
  saveState();
  hapticNotify('success');
  closeModal('modal-cat');
  renderSettings();
  renderHistory();
  renderHome();
}

function deleteCat() {
  const c = state.categories[catEdit.scope].find(x => x.id === catEdit.id);
  if (!c) return;
  if (!confirm('Удалить категорию «' + c.name + '»? Операции с ней сохранятся и будут показаны как «Без категории».')) return;
  state.categories[catEdit.scope] = state.categories[catEdit.scope].filter(x => x.id !== catEdit.id);
  saveState();
  hapticNotify('warning');
  closeModal('modal-cat');
  renderSettings();
  refreshAfterDataChange();
}

/* ============================================================
   16. МОДАЛКА: КРИПТО-АКТИВ
   ============================================================ */

let assetEditId = null;

function openAssetModal(id) {
  assetEditId = id;
  const a = id ? state.crypto.assets.find(x => x.id === id) : null;
  $('#as-title').textContent = a ? 'Изменить актив' : 'Новый актив';
  $('#as-emoji').value = a ? a.emoji : '🪙';
  $('#as-symbol').value = a ? a.symbol : '';
  $('#as-name').value = a ? a.name : '';
  $('#as-id').value = a ? a.coingeckoId : '';
  $('#as-delete').classList.toggle('hidden', !a);
  openModal('modal-asset');
}

function saveAsset() {
  const emoji = $('#as-emoji').value.trim() || '🪙';
  const symbol = $('#as-symbol').value.trim().toUpperCase();
  const name = $('#as-name').value.trim();
  const cgId = $('#as-id').value.trim().toLowerCase();
  if (!symbol) { toast('Введите тикер (например BTC)', true); return; }
  if (!cgId) { toast('Введите идентификатор CoinGecko', true); return; }

  if (assetEditId) {
    const a = state.crypto.assets.find(x => x.id === assetEditId);
    if (a) { a.emoji = emoji; a.symbol = symbol; a.name = name || symbol; a.coingeckoId = cgId; }
  } else {
    state.crypto.assets.push({ id: uid('as'), coingeckoId: cgId, symbol, name: name || symbol, emoji });
  }
  saveState();
  hapticNotify('success');
  closeModal('modal-asset');
  renderSettings();
  renderCrypto();
  renderHome();
  /* Сразу пробуем подтянуть цену нового актива (с учётом лимита раз в минуту) */
  Rates.refresh().then(() => { renderCrypto(); renderHome(); }).catch(() => {});
}

function deleteAsset() {
  const a = state.crypto.assets.find(x => x.id === assetEditId);
  if (!a) return;
  const opsCount = state.crypto.operations.filter(o => o.assetId === a.id).length;
  const msg = opsCount
    ? 'Удалить актив ' + a.symbol + '? Связанных операций: ' + opsCount + ' — они тоже будут удалены!'
    : 'Удалить актив ' + a.symbol + '?';
  if (!confirm(msg)) return;
  state.crypto.assets = state.crypto.assets.filter(x => x.id !== assetEditId);
  state.crypto.operations = state.crypto.operations.filter(o => o.assetId !== assetEditId);
  saveState();
  hapticNotify('warning');
  closeModal('modal-asset');
  renderSettings();
  refreshAfterDataChange();
}

/* ============================================================
   17. ЭКСПОРТ / ИМПОРТ / СТИРАНИЕ
   ============================================================ */

function exportData() {
  try {
    state.settings.lastExportAt = nowLocalValue();
    saveState();
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    a.href = url;
    a.download = 'finance-backup-'
      + d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
      + '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    hapticNotify('success');
    toast('Файл резервной копии скачан');
    renderSettings();
    renderHome();
  } catch (e) {
    toast('Не удалось создать файл экспорта', true);
  }
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!data || typeof data !== 'object'
        || !data.personal || !data.business || !data.crypto || !data.categories) {
        throw new Error('bad structure');
      }
      if (!confirm('Заменить все текущие данные данными из файла? Текущие данные будут сохранены в резервную копию браузера.')) return;
      try { localStorage.setItem(LS_BACKUP, JSON.stringify(state)); } catch (e) {}
      state = deepMerge(DEFAULT_STATE, data);
      saveState();
      lastTotalShown = null;
      refreshAfterDataChange();
      renderSettings();
      hapticNotify('success');
      toast('Данные восстановлены из файла');
    } catch (e) {
      toast('Файл повреждён или не подходит', true);
      hapticNotify('error');
    }
  };
  reader.onerror = () => toast('Не удалось прочитать файл', true);
  reader.readAsText(file);
}

function wipeAll() {
  if (!confirm('Удалить ВСЕ данные? Сначала сделайте экспорт — без него восстановить будет нечего!')) return;
  if (!confirm('Точно удалить всё? Это последнее предупреждение.')) return;
  try { localStorage.setItem(LS_BACKUP, JSON.stringify(state)); } catch (e) {}
  state = structuredClone(DEFAULT_STATE);
  saveState();
  lastTotalShown = null;
  refreshAfterDataChange();
  hapticNotify('warning');
  toast('Все данные удалены');
}

/* ============================================================
   18. ТОСТ И МОДАЛКИ
   ============================================================ */

let toastTimer = null;
function toast(msg, isErr = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('err', isErr);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function openModal(id) {
  $('#' + id).classList.add('open');
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  const m = $('#' + id);
  if (m) m.classList.remove('open');
  if (!document.querySelector('.modal.open')) {
    document.body.classList.remove('modal-open');
    hideMainButton();
  }
}

/* ============================================================
   19. ОБНОВЛЕНИЕ КОТИРОВОК ВРУЧНУЮ
   ============================================================ */

async function refreshRatesManual() {
  hapticTap();
  const btns = document.querySelectorAll('#btn-refresh-rates, #btn-refresh-rates-2');
  btns.forEach(b => { b.disabled = true; b.textContent = 'Обновляю…'; });
  try {
    const res = await Rates.refresh();
    if (res.throttled) {
      toast('Котировки обновлялись меньше минуты назад');
    } else if (res.ok) {
      toast('Котировки обновлены');
      hapticNotify('success');
    } else {
      toast('Не удалось получить котировки — проверьте интернет', true);
    }
  } catch (e) {
    toast('Ошибка обновления котировок', true);
  } finally {
    renderHome();
    renderCrypto();
    const active = document.querySelector('.screen.active');
    if (active && active.id === 'screen-stats') renderStats();
    btns.forEach(b => { b.disabled = false; b.textContent = 'Обновить'; });
  }
}

/* ============================================================
   20. НАЗНАЧЕНИЕ ОБРАБОТЧИКОВ
   ============================================================ */

function bindEvents() {

  /* --- Навигация --- */
  document.querySelectorAll('.tabbar .tab').forEach(t =>
    t.addEventListener('click', () => { hapticSelect(); showScreen(t.dataset.screen); }));

  $('#fab').addEventListener('click', () => { hapticTap(); openOpModal({ scope: 'personal' }); });
  $('#btn-home-settings').addEventListener('click', () => showScreen('screen-settings'));
  $('#btn-hist-add').addEventListener('click', () => { hapticTap(); openOpModal({ scope: histScope }); });
  $('#btn-crypto-op').addEventListener('click', () => { hapticTap(); openCryptoModal({}); });
  $('#btn-crypto-assets').addEventListener('click', () => showScreen('screen-settings'));

  /* --- Баннер напоминания --- */
  $('#banner-export-btn').addEventListener('click', exportData);
  $('#banner-ok-btn').addEventListener('click', () => {
    state.settings.exportReminderShown = true;
    saveState();
    renderHome();
  });

  /* --- Котировки --- */
  $('#btn-refresh-rates').addEventListener('click', refreshRatesManual);
  $('#btn-refresh-rates-2').addEventListener('click', refreshRatesManual);

  /* --- Тап по операции открывает её редактирование (главная, история, крипта) --- */
  document.addEventListener('click', e => {
    const row = e.target.closest('.op-row');
    if (row) {
      if (row.dataset.cryptoId) {
        openCryptoModal({ editId: row.dataset.cryptoId });
      } else if (row.dataset.opId) {
        openOpModal({ scope: row.dataset.opScope, editId: row.dataset.opId });
      }
      return;
    }
    const catRow = e.target.closest('.cat-row');
    if (catRow) {
      openCatModal(catRow.dataset.catScope, catRow.dataset.catId);
      return;
    }
    const assetRow = e.target.closest('.asset-row');
    if (assetRow) {
      openAssetModal(assetRow.dataset.assetId);
      return;
    }
    const closer = e.target.closest('.modal-close');
    if (closer) {
      closeModal(closer.dataset.close);
      return;
    }
    /* Клик по затемнённому фону закрывает шторку */
    if (e.target.classList && e.target.classList.contains('modal')) {
      closeModal(e.target.id);
    }
  });

  /* --- История: переключение счёта и месяца --- */
  document.querySelectorAll('#hist-scope .seg-btn').forEach(b =>
    b.addEventListener('click', () => {
      histScope = b.dataset.scope;
      histMonth = 'all';
      hapticSelect();
      renderHistory();
    }));
  $('#hist-month').addEventListener('change', e => {
    histMonth = e.target.value;
    renderHistory();
  });

  /* --- Статистика: переключение счёта и периода --- */
  document.querySelectorAll('#stat-scope .seg-btn').forEach(b =>
    b.addEventListener('click', () => { statScope = b.dataset.scope; hapticSelect(); renderStats(); }));
  document.querySelectorAll('#stat-period .seg-btn').forEach(b =>
    b.addEventListener('click', () => { statPeriod = b.dataset.period; hapticSelect(); renderStats(); }));

  /* --- Модалка фиатной операции --- */
  document.querySelectorAll('#op-scope .seg-btn').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.scope !== opSt.scope) {
        opSt.scope = b.dataset.scope;
        opSt.categoryId = null;
        hapticSelect();
        syncOpUI();
      }
    }));
  document.querySelectorAll('#op-type .seg-btn').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.type !== opSt.type) {
        opSt.type = b.dataset.type;
        opSt.categoryId = null;
        hapticSelect();
        syncOpUI();
      }
    }));
  $('#op-cats').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.catId) {
      opSt.categoryId = chip.dataset.catId;
      hapticSelect();
      renderOpCats();
    }
  });
  $('#op-keypad').addEventListener('click', e => {
    const key = e.target.closest('.key');
    if (key) {
      pressKey(key.dataset.key, opSt, 2);
      hapticTap();
      $('#op-amount-display').textContent = opSt.amountStr === '' ? '0' : opSt.amountStr;
    }
  });
  $('#op-save').addEventListener('click', saveOp);
  $('#op-delete').addEventListener('click', deleteOp);

  /* --- Модалка крипто-операции --- */
  $('#cr-assets').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.assetId && !chip.disabled) {
      crSt.assetId = chip.dataset.assetId;
      hapticSelect();
      syncCrUI();
    }
  });
  document.querySelectorAll('#cr-type .seg-btn').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.type !== crSt.type) {
        crSt.type = b.dataset.type;
        hapticSelect();
        syncCrUI();
      }
    }));
  $('#cr-keypad').addEventListener('click', e => {
    const key = e.target.closest('.key');
    if (key) {
      pressKey(key.dataset.key, crSt, 8);
      hapticTap();
      $('#cr-amount-display').textContent = crSt.amountStr === '' ? '0' : crSt.amountStr;
      updateCrHint();
    }
  });
  $('#cr-save').addEventListener('click', saveCryptoOp);
  $('#cr-delete').addEventListener('click', deleteCryptoOp);

  /* --- Модалка категории --- */
  $('#cat-emoji-presets').addEventListener('click', e => {
    const chip = e.target.closest('.chip');
    if (chip && chip.dataset.emoji) $('#cat-emoji').value = chip.dataset.emoji;
  });
  $('#cat-save').addEventListener('click', saveCat);
  $('#cat-delete').addEventListener('click', deleteCat);

  /* --- Модалка актива --- */
  $('#as-save').addEventListener('click', saveAsset);
  $('#as-delete').addEventListener('click', deleteAsset);

  /* --- Настройки --- */
  $('#btn-export').addEventListener('click', exportData);
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    importData(e.target.files[0]);
    e.target.value = ''; /* чтобы можно было выбрать тот же файл повторно */
  });
  $('#btn-add-cat-personal').addEventListener('click', () => openCatModal('personal', null));
  $('#btn-add-cat-business').addEventListener('click', () => openCatModal('business', null));
  $('#btn-add-asset').addEventListener('click', () => openAssetModal(null));
  $('#btn-wipe').addEventListener('click', wipeAll);
}

/* ============================================================
   21. ЗАПУСК
   ============================================================ */

function init() {
  loadState();
  initTelegram();
  buildKeypad($('#op-keypad'));
  buildKeypad($('#cr-keypad'));
  bindEvents();
  renderHome();
  renderHistory();
  renderCrypto();
  renderSettings();

  /* Первое обновление котировок при открытии (не чаще раза в минуту) */
  Rates.refresh().then(res => {
    renderHome();
    renderCrypto();
    if (res && !res.ok && !res.throttled) {
      /* Сети нет — сообщаем, но приложение продолжает работать на сохранённых данных */
      toast('Нет сети — показаны сохранённые котировки');
    }
  }).catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);