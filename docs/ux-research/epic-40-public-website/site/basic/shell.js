(function(){
  var d=document.documentElement;
  function applyLang(){var l=d.dataset.lang||'bn';document.querySelectorAll('[data-bn]').forEach(function(o){o.textContent=o.dataset[l]||o.dataset.bn});document.querySelectorAll('[data-ph-bn]').forEach(function(i){i.placeholder=i.dataset['ph'+(l==='en'?'En':'Bn')]||''})}
  try{var s=localStorage.getItem('site-lang');if(s)d.dataset.lang=s;}catch(e){} applyLang();
  document.querySelectorAll('.lang button').forEach(function(b){b.addEventListener('click',function(){d.dataset.lang=b.dataset.set;try{localStorage.setItem('site-lang',b.dataset.set)}catch(e){} applyLang()})});
  var sheet=document.getElementById('sheet');
  document.querySelectorAll('[data-open-menu]').forEach(function(b){b.addEventListener('click',function(){sheet.setAttribute('open','');document.body.style.overflow='hidden'})});
  document.querySelectorAll('[data-close-menu]').forEach(function(b){b.addEventListener('click',function(){sheet.removeAttribute('open');document.body.style.overflow=''})});
  document.querySelectorAll('.island[data-loading]').forEach(function(el){setTimeout(function(){el.removeAttribute('data-loading')},1200)});
  document.querySelectorAll('[data-expand]').forEach(function(b){b.addEventListener('click',function(){var t=document.getElementById(b.dataset.expand);var open=t.hasAttribute('hidden');t.toggleAttribute('hidden',!open);b.setAttribute('aria-expanded',open)})});
  document.querySelectorAll('.filters button').forEach(function(b){b.addEventListener('click',function(){b.parentNode.querySelectorAll('button').forEach(function(x){x.setAttribute('aria-pressed','false')});b.setAttribute('aria-pressed','true')})});
})();
