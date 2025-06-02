// ==UserScript==
// @name         Thimbles — валюта + ×1000 + точный масштаб (v1.8)
// @namespace    http://tampermonkey.net/
// @version      1.8
// @description  DMO→IDR, ×1000, формат «1 000 000 IDR», уменьшаем ТОЛЬКО суммы; random/auto/коэффициенты не трогаем.
// @match        https://games.pixmove.co/thimbles*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* ╔════  C O N F I G  ════╗ */
const CFG = {
  currency            : 'IDR',   // выводимая валюта
  multiplier          : 10000,    // во сколько раз увеличивать суммы
  spaceBeforeCurrency : true,    // «1 000 IDR» (а не «1 000IDR»)

  // ——— коэффициенты масштаба ———
  scale : {
    label          : 1.00,  // WIN:/BET:/CASH:   ← не меняем
    amountCanvas   : 0.62,  // суммы, рисуемые Canvas (выигрыш по центру)
    amountPixiText : 0.60,  // суммы, PIXI.Text   (всплывающие числа)
    amountPixiBmp  : 0.75   // суммы, PIXI.BitmapText (нижняя строка CASH/BET/WIN)
  }
};
/* ╚═══════════════════════╝ */

(function () {
  'use strict';

  /* ───────────────── helpers ───────────────── */
  const fmtInt = n => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const isCoef = s => /^[x×]\s*\d/i.test(s);           // x1,42  / ×2.85
  const isWord = s => /^[a-z]{3,}$/i.test(s);          // random / auto

  /** заменяем валюту + ×1000 + пробелы */
  function transform(txt) {
    let t = String(txt);

    // 1. Валюта
    t = t.replace(/DMO/g, CFG.currency);

    // 2. Числа
    t = t.replace(/\d[\d\s]*(?:[.,]\d+)?/g, m => {
      const raw = m.replace(/\s/g, '').replace(',', '.');
      const num = parseFloat(raw);
      const isMultiplier = num < 3 && Math.abs(num - Math.round(num)) > 1e-6;
      return isNaN(num) || isMultiplier ? m
           : fmtInt(Math.round(num * CFG.multiplier));
    });

    // 3. Один пробел перед валютой
    if (CFG.spaceBeforeCurrency) {
      t = t.replace(/(\d[\d\s]*)\s*IDR/g, (_, n) => `${n.trim()} ${CFG.currency}`);
    }

    // 4. WIN/BET/CASH: один пробел после двоеточия
    t = t.replace(/\b(WIN|BET|CASH)\s*:?\s+/gi, (_, l) => `${l.toUpperCase()}: `);

    return t;
  }

  /** классифицируем уже _трансформированный_ текст */
  function kind(txt) {
    if (/^(WIN|BET|CASH)\b/i.test(txt)) return 'label';
    if (isWord(txt) || isCoef(txt))     return 'other';
    if (/\bIDR\b/i.test(txt))          return 'amount';
    const digits = txt.replace(/\D/g, '');
    return digits.length >= 4 ? 'amount' : 'other';
  }

  /* ───────────────── Canvas 2D ───────────────── */
  ['fillText', 'strokeText'].forEach(fn => {
    const orig = CanvasRenderingContext2D.prototype[fn];
    CanvasRenderingContext2D.prototype[fn] = function (txt, x, y, maxW) {
      const newTxt = transform(txt);
      const k = kind(newTxt);

      let save = this.font;
      if (k === 'amount') {
        const factor = CFG.scale.amountCanvas;
        this.font = save.replace(/(\d+)(px|pt)/,
          (_, s, unit) => Math.round(s * factor) + unit);
      } else if (k === 'label') {
        const factor = CFG.scale.label;
        if (factor !== 1) {
          this.font = save.replace(/(\d+)(px|pt)/,
            (_, s, unit) => Math.round(s * factor) + unit);
        }
      }
      orig.call(this, newTxt, x, y, maxW);
      this.font = save;
    };
  });

  /* ───────────────── PixiJS ────────────────── */
  const wait = setInterval(() => {
    if (!window.PIXI) return;

    ['Text', 'BitmapText'].forEach(cls => {
      const P = PIXI[cls]?.prototype;
      if (!P) return;

      const desc = Object.getOwnPropertyDescriptor(P, 'text');
      if (!desc?.set) return; // уже пропатчено

      Object.defineProperty(P, 'text', {
        get: desc.get,
        set(v) {
          const newTxt = typeof v === 'string' ? transform(v) : v;
          desc.set.call(this, newTxt);

          const k = typeof newTxt === 'string' ? kind(newTxt) : 'other';
          let factor = 1;

          if (k === 'label')       factor = CFG.scale.label;
          else if (k === 'amount') factor = cls === 'BitmapText'
                                     ? CFG.scale.amountPixiBmp
                                     : CFG.scale.amountPixiText;

          if (!this.__origSize) {
            this.__origSize = cls === 'BitmapText'
              ? this.fontSize
              : this.style.fontSize || 0;
          }
          if (factor !== 1) {
            if (cls === 'BitmapText')
              this.fontSize = this.__origSize * factor;
            else
              this.style.fontSize = this.__origSize * factor;

            this.dirty = this._dirty = true;
          }
        }
      });
    });

    clearInterval(wait);
  }, 100);
})();
