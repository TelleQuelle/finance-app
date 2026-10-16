/* ============================================================
   api.js — получение котировок (крипта и курс USD/RUB)
   Все запросы бесплатны и не требуют ключей:
   - CoinGecko /simple/price (сразу в USD и RUB)
   - open.er-api.com (курс USD -> RUB)
   - cbr-xml-daily.ru (запасной источник курса)
   Результаты кэшируются в state.rates и переживают отсутствие сети.
   ============================================================ */

/* fetch с таймаутом: если сеть висит, не ждём вечно */
function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal }).finally(() => clearTimeout(t));
}

const Rates = {

  /* Минимальный интервал между запросами — 60 секунд (лимиты бесплатных API) */
  MIN_INTERVAL: 60000,

  /*
   * Обновление котировок.
   * Возвращает { ok, throttled }:
   *  - throttled: true — с прошлого запроса прошло меньше минуты, запрос не выполнялся;
   *  - ok: true — удалось получить хотя бы часть данных.
   * Если сеть недоступна — просто остаются сохранённые котировки.
   */
  async refresh() {
    const now = Date.now();

    if (now - state.rates.lastFetchAt < this.MIN_INTERVAL) {
      return { ok: !!state.rates.updatedAt, throttled: true };
    }
    state.rates.lastFetchAt = now;

    const ids = state.crypto.assets
      .map(a => a.coingeckoId)
      .filter(Boolean)
      .join(',');

    let cryptoOk = false;
    let fiatOk = false;

    /* --- 1. Крипто-цены из CoinGecko (usd + rub одним запросом) --- */
    if (ids) {
      try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids='
          + encodeURIComponent(ids) + '&vs_currencies=usd,rub';
        const res = await fetchTimeout(url, 10000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        for (const a of state.crypto.assets) {
          const row = data[a.coingeckoId];
          if (row && typeof row.usd === 'number' && typeof row.rub === 'number') {
            state.rates.crypto[a.coingeckoId] = { usd: row.usd, rub: row.rub };
            cryptoOk = true;
          }
        }
      } catch (e) {
        /* Сеть недоступна или лимит — работаем на сохранённых ценах */
      }
    }

    /* --- 2. Курс USD/RUB: основной источник --- */
    try {
      const res = await fetchTimeout('https://open.er-api.com/v6/latest/USD', 10000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data && data.rates && typeof data.rates.RUB === 'number') {
        state.rates.usdRub = data.rates.RUB;
        fiatOk = true;
      }
    } catch (e) { /* пробуем запасной источник ниже */ }

    /* --- 3. Запасной источник курса: ЦБ через cbr-xml-daily.ru --- */
    if (!fiatOk) {
      try {
        const res = await fetchTimeout('https://cbr-xml-daily.ru/daily_json.js', 10000);
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (data && data.Valute && data.Valute.USD && typeof data.Valute.USD.Value === 'number') {
          state.rates.usdRub = data.Valute.USD.Value;
          fiatOk = true;
        }
      } catch (e) { /* остаётся старый курс */ }
    }

    /* --- 4. Если курс так и не получили, но крипта есть — вычисляем из пары usd/rub --- */
    if (!fiatOk && cryptoOk) {
      for (const a of state.crypto.assets) {
        const c = state.rates.crypto[a.coingeckoId];
        if (c && c.usd > 0 && c.rub > 0) {
          state.rates.usdRub = c.rub / c.usd;
          fiatOk = true;
          break;
        }
      }
    }

    /* Пометка времени только при частично успешном обновлении */
    if (cryptoOk || fiatOk) {
      state.rates.updatedAt = nowLocalValue();
    }

    saveState();
    return { ok: cryptoOk || fiatOk, throttled: false };
  },

  /*
   * Текущая цена актива по последним сохранённым котировкам.
   * Возвращает { usd, rub } или null, если цены нет.
   */
  getPrice(assetId) {
    const asset = state.crypto.assets.find(a => a.id === assetId);
    if (!asset || !asset.coingeckoId) return null;
    const c = state.rates.crypto[asset.coingeckoId];
    if (c && typeof c.usd === 'number' && typeof c.rub === 'number') {
      return { usd: c.usd, rub: c.rub };
    }
    return null;
  }
};