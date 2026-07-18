/*
 * kalibrasyon.js — paper trading güven/eşik kalibrasyon tablosu.
 * 50+ kapanış biriktiğinde çalıştır: node kalibrasyon.js
 * Amaç: conf bandı × sonuç ilişkisine bakıp MIN_CONF eşiğini ve confidence formülünü KANITA göre yeniden çizmek.
 * (18 Tem 2026 bulgusu: 29 kapanışta conf 95+ ortR -0.12 < conf 75-94 +0.58 — güven kalibre değildi.)
 */
const s = require('./paper_state.json');
const cl = s.closed || [];
const g = (arr, f) => { const m = {}; arr.forEach(t => { const k = f(t); m[k] = m[k] || { n: 0, r: 0, w: 0, usd: 0, tp1: 0 }; m[k].n++; m[k].r += t.r || 0; m[k].usd += t.realized || 0; if (t.realized > 0) m[k].w++; if ((t.fills || []).some(x => x.why === 'TP1-derisk')) m[k].tp1++; }); return m; };
const show = (name, m) => {
  console.log('\n--- ' + name + ' ---');
  console.log('  '.padEnd(14) + 'n'.padStart(4) + 'WR%'.padStart(6) + 'ortR'.padStart(8) + 'topR'.padStart(8) + '$'.padStart(9) + 'TP1%'.padStart(7));
  Object.entries(m).sort().forEach(([k, v]) => console.log('  ' + k.padEnd(12) + String(v.n).padStart(4) + String(Math.round(100 * v.w / v.n)).padStart(6) + (v.r / v.n).toFixed(2).padStart(8) + v.r.toFixed(1).padStart(8) + v.usd.toFixed(0).padStart(9) + String(Math.round(100 * v.tp1 / v.n)).padStart(7)));
};
console.log('==== KALİBRASYON — ' + cl.length + ' kapanış | toplam ' + cl.reduce((a, t) => a + (t.r || 0), 0).toFixed(2) + 'R / ' + cl.reduce((a, t) => a + (t.realized || 0), 0).toFixed(0) + '$ ====');
if (cl.length < 50) console.log('!! ' + cl.length + '/50 kapanış — örneklem henüz küçük, kararları 50+ sonrasına bırak.');
show('GÜVEN BANDI', g(cl, t => t.conf >= 95 ? '95-99' : t.conf >= 85 ? '85-94' : '75-84'));
show('NOT', g(cl, t => t.grade));
show('TF', g(cl, t => t.tf));
show('MMxM SKOR', g(cl, t => 'skor ' + (t.mmxm ? t.mmxm.score : '-')));
show('YÖN', g(cl, t => t.side));
show('SONUÇ', g(cl, t => t.closeReason));
show('DERISK', g(cl, t => (t.fills || []).some(f => f.why === 'TP1-derisk') ? 'TP1 gördü' : 'göremedi'));
// çapraz: conf bandı × TF (kalibrasyonun kalbi)
console.log('\n--- GÜVEN × TF (ortR | n) ---');
const bands = ['75-84', '85-94', '95-99'], tfs = [...new Set(cl.map(t => t.tf))].sort();
console.log('  '.padEnd(8) + tfs.map(x => x.padStart(14)).join(''));
for (const b of bands) {
  const row = tfs.map(tf => { const ss = cl.filter(t => t.tf === tf && (t.conf >= 95 ? '95-99' : t.conf >= 85 ? '85-94' : '75-84') === b); return ss.length ? ((ss.reduce((a, t) => a + t.r, 0) / ss.length).toFixed(2) + '|' + ss.length).padStart(14) : '-'.padStart(14); });
  console.log('  ' + b.padEnd(6) + row.join(''));
}
console.log('\nYORUM REHBERİ: TP1% = işlemin 1.5R hedefini görme oranı (sistemin tek gerçek sürücüsü; ~%39 başabaş).');
console.log("Bir bandın ortR'si belirgin negatifse eşik/formül o banda göre revize edilir; n<8 hücreleri yok say.");
