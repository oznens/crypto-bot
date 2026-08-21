#!/usr/bin/env python3
import json, re
from urllib.request import Request, urlopen

FALLBACK = [
    'AKBNK','ALARK','ARCLK','ASELS','ASTOR','BIMAS','DOAS','EKGYO','ENJSA','EREGL',
    'FROTO','GARAN','GESAN','GUBRF','HEKTS','ISCTR','KCHOL','KONTR','KOZAL','KRDMD',
    'MGROS','ODAS','OYAKC','PETKM','PGSUS','SAHOL','SASA','SISE','SMRTG','TAVHL',
    'TCELL','THYAO','TOASO','TSKB','TUPRS','ULKER','VAKBN','VESTL','YKBNK','ZOREN',
    'AGHOL','AEFES','AKSA','AKSEN','ALFAS','CCOLA','CWENE','EGEEN','ENKAI','GWIND',
    'HALKB','ISGYO','IZENR','JANTS','KARSN','MAVI','MPARK','OTKAR','QUAGR','SKBNK',
    'SOKM','TABGD','TKFEN','TRGYO','TTRAK'
]

def get_bist_stocks():
    """Return all TradingView Turkey screener instruments classified as stocks on BIST."""
    payload = {
        'filter': [
            {'left': 'type', 'operation': 'equal', 'right': 'stock'},
            {'left': 'exchange', 'operation': 'equal', 'right': 'BIST'},
        ],
        'options': {'lang': 'tr'},
        'markets': ['turkey'],
        'symbols': {'query': {'types': []}, 'tickers': []},
        'columns': ['name', 'type', 'exchange', 'close', 'volume'],
        'sort': {'sortBy': 'name', 'sortOrder': 'asc'},
        'range': [0, 2000],
    }
    req = Request(
        'https://scanner.tradingview.com/turkey/scan',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0'},
        method='POST',
    )
    try:
        with urlopen(req, timeout=25) as r:
            obj = json.load(r)
        out = []
        for item in obj.get('data', []):
            raw = item.get('s', '')
            if not raw.startswith('BIST:'):
                continue
            sym = raw.split(':', 1)[1].strip().upper()
            # Ordinary BIST share symbols are compact alphanumeric tickers. This also keeps
            # share classes such as ISATR/ISBTR while excluding synthetic scanner rows.
            if re.fullmatch(r'[A-Z0-9]{2,12}', sym):
                out.append(sym)
        out = sorted(set(out))
        if len(out) >= 100:
            return out, 'TradingView Turkey screener'
    except Exception as e:
        return FALLBACK[:], f'fallback ({type(e).__name__}: {e})'
    return FALLBACK[:], 'fallback (unexpectedly small screener universe)'

if __name__ == '__main__':
    syms, src = get_bist_stocks()
    print(src, len(syms))
    print('\n'.join(syms))
