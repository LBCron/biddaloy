/* Shared behaviour for the theme mockups. Query switches used by the shoot script:
   ?photos=1     one hero photo only        ?palette=1|2  apply a palette set (0 = theme default)
   ?skip=<id|n>  remove one whole section   ?notag=1      drop the hero tagline
   ?crop=1       keep header, bar, hero and the next sections (palette preview frames)
   ?marquee=1    announcement bar with one item: one static line, no scroll (D30) */
(function () {
  var q = new URLSearchParams(location.search),
    root = document.documentElement;
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || !!q.get('crop'); // preview frames stay on slide 1

  // palettes (D28): a set gives primary/secondary/accent/surface/ink, map says which CSS variables follow
  var theme = root.dataset.theme,
    P = window.SITE_PALETTES && window.SITE_PALETTES[theme];
  var pi = +q.get('palette') || 0;
  if (P && pi > 0 && P.sets[pi]) {
    var set = P.sets[pi];
    Object.keys(P.map).forEach(function (tok) {
      P.map[tok].forEach(function (spec) {
        var p = spec.split(':'),
          c = set[tok];
        if (p[1])
          c =
            'color-mix(in srgb,' +
            c +
            ' ' +
            (100 - +p[1].slice(1)) +
            '%,' +
            (p[1][0] === 'k' ? '#000' : '#fff') +
            ')';
        root.style.setProperty(p[0], c);
      });
    });
  }

  // announcement bar (D30). One item: one static line. Reduced motion with 2+ items: no scroll,
  // one item at a time and prev/next buttons, so items 2-5 stay reachable.
  var rm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.ann').forEach(function (bar) {
    var sets = bar.querySelectorAll('.ann-set');
    if (!sets.length) return;
    if (q.get('marquee') === '1')
      [].forEach.call(sets, function (s) {
        [].slice.call(s.children, 1).forEach(function (a) {
          a.remove();
        });
      });
    var items = [].slice.call(sets[0].children),
      k = 0;
    bar.setAttribute('data-count', items.length);
    if (!rm || items.length < 2) return;
    var step = document.createElement('div');
    step.className = 'ann-step';
    step.innerHTML =
      '<button type="button" aria-label="আগের ঘোষণা / Previous notice">‹</button><button type="button" aria-label="পরের ঘোষণা / Next notice">›</button>';
    function show(n) {
      k = (n + items.length) % items.length;
      items.forEach(function (a, j) {
        a.classList.toggle('on', j === k);
      });
    }
    step.children[0].onclick = function () {
      show(k - 1);
    };
    step.children[1].onclick = function () {
      show(k + 1);
    };
    bar.setAttribute('data-step', '');
    bar.appendChild(step);
    show(0);
  });

  // hero carousel (D26)
  var one = q.get('photos') === '1';
  document.querySelectorAll('[data-carousel]').forEach(function (hc) {
    var track = hc.querySelector('.hc-track'),
      slides = [].slice.call(track.children);
    if (one) {
      slides.slice(1).forEach(function (s) {
        s.remove();
      });
      hc.setAttribute('data-single', '');
      return;
    }
    var dots = [].slice.call(hc.querySelectorAll('.hc-dots button')),
      i = 0,
      timer,
      hover = false,
      focus = false;
    function go(n) {
      i = (n + slides.length) % slides.length;
      track.style.transform = 'translateX(' + -100 * i + '%)';
      slides.forEach(function (s, k) {
        s.setAttribute('aria-hidden', k !== i);
        s.inert = k !== i;
      });
      dots.forEach(function (d, k) {
        d.setAttribute('aria-current', k === i);
      });
    }
    function start() {
      clearInterval(timer);
      if (!reduce)
        timer = setInterval(function () {
          if (!hover && !focus) go(i + 1);
        }, 6000);
    }
    hc.querySelector('.hc-prev').onclick = function () {
      go(i - 1);
      start();
    };
    hc.querySelector('.hc-next').onclick = function () {
      go(i + 1);
      start();
    };
    dots.forEach(function (d, k) {
      d.onclick = function () {
        go(k);
        start();
      };
    });
    // paused while the pointer is over it OR focus is inside it (WCAG 2.2.2): leaving with the
    // mouse must not restart it under a focused button, or the next slide makes that button inert
    hc.addEventListener('mouseenter', function () {
      hover = true;
    });
    hc.addEventListener('mouseleave', function () {
      hover = false;
    });
    hc.addEventListener('focusin', function () {
      focus = true;
    });
    hc.addEventListener('focusout', function (e) {
      if (!hc.contains(e.relatedTarget)) focus = false;
    });
    var x0 = null;
    hc.addEventListener('pointerdown', function (e) {
      x0 = e.clientX;
    });
    hc.addEventListener('pointerup', function (e) {
      if (x0 === null) return;
      var dx = e.clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 40) {
        go(i + (dx < 0 ? 1 : -1));
        start();
      }
    });
    go(0);
    start();
  });

  // "skipped" variant (D25): one whole section and the tagline removed, layout must still look finished
  var skip = q.get('skip');
  if (skip) {
    var all = [].slice
      .call(document.querySelectorAll('body > section, main > section'))
      .filter(function (s) {
        return !s.matches('.hero,.hc-band');
      });
    var el = /^\d+$/.test(skip) ? all[+skip - 1] : document.getElementById(skip);
    if (el) el.remove();
  }
  if (q.get('notag')) {
    var tg = document.querySelector('[data-tagline]');
    if (tg) tg.remove();
  }

  // palette preview frame (palettes.html embeds this page cropped)
  if (q.get('crop')) {
    // hero + the next content section only; hidden, not removed, because the themes' own island scripts look sections up by id
    var hero = document.querySelector('.hero'),
      n = hero.nextElementSibling;
    while (n && (n.tagName !== 'SECTION' || n.matches('.hc-band,.strip'))) n = n.nextElementSibling;
    [].slice.call(hero.parentElement.children).forEach(function (c) {
      if (c !== hero && c !== n && !c.matches('header,.ann,script,style,.hc-band'))
        c.style.display = 'none';
    });
    if (hero.parentElement !== document.body)
      [].slice.call(document.body.children).forEach(function (c) {
        if (!c.contains(hero) && !c.matches('header,.ann,script,style')) c.style.display = 'none';
      });
    addEventListener('load', function () {
      setTimeout(function () {
        parent.postMessage({ palette: pi, h: root.scrollHeight }, '*');
      }, 900);
    });
  }
})();
