'use strict';

/*
 * Eski backtest motorunu bir önceki 30 günlük pencereye taşır.
 * Tarihsel bitiş = gerçek zaman - OFFSET_DAYS (varsayılan 30 gün)
 * Test süresi = GUN (varsayılan 30 gün)
 */
const OFFSET_DAYS = Number(process.env.OFFSET_DAYS || 30);
const realNow = Date.now.bind(Date);
const shiftedNow = realNow() - OFFSET_DAYS * 86400 * 1000;
Date.now = () => shiftedNow;

process.env.GUN = process.env.GUN || '30';
process.env.SYMS = process.env.SYMS || '30';

require('./backtest3ay');
