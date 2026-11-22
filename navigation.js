'use strict';
(() => {
  const mount = document.getElementById('workspace-navigation');
  if (!mount || window.parent !== window) return;
  let page = 'index.html', activeHash = ''; 
  const groups = [
    {id:'receipts',title:'レシート管理',links:[{href:'editor.html',label:'読込・編集'}]},
    {id:'review',title:'集計・確認',links:[
      {href:'summary.html',label:'全体の集計'},
      {href:'summary.html#receipt-list',label:'レシート一覧'}
    ]}
  ];
  const sidebar = document.createElement('aside');
  sidebar.id = 'workspace-sidebar';
  sidebar.className = 'workspace-sidebar';
  sidebar.setAttribute('aria-label','メインメニュー');
  const brand = document.createElement('a');
  brand.className = 'brand'; brand.href = 'index.html';
  brand.textContent = 'Expense Desk';
  brand.onclick = event => {event.preventDefault();window.ReceiptSession.navigate('index.html');};
  const subtitle = document.createElement('small');
  subtitle.textContent = 'レシート・経費管理'; brand.append(subtitle);
  const close = document.createElement('button');
  close.className = 'sidebar-close'; close.type = 'button'; close.textContent = '閉じる';
  sidebar.append(brand,close);
  const nav = document.createElement('nav');
  nav.className = 'tree-navigation'; nav.setAttribute('aria-label','機能一覧');
  const links = [];
  function addLink(parent, item) {
    const link = document.createElement('a');
    link.href = item.href; link.textContent = item.label;
    parent.append(link); links.push(link);
  }
  addLink(nav,{href:'index.html',label:'ホーム'});
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('expense-desk-navigation') || '{}') || {}; } catch {}
  for (const group of groups) {
    const details = document.createElement('details');
    details.open = saved[group.id] !== false;
    const summary = document.createElement('summary'); summary.textContent = group.title;
    const children = document.createElement('div'); children.className = 'tree-children';
    for (const item of group.links) addLink(children,item);
    details.append(summary,children); nav.append(details);
    details.addEventListener('toggle',() => {
      saved[group.id] = details.open;
      try { localStorage.setItem('expense-desk-navigation',JSON.stringify(saved)); } catch {}
    });
  }
  addLink(nav,{href:'connection.html',label:'GitHub接続'});
  sidebar.append(nav);
  const mobileBar = document.createElement('div'); mobileBar.className = 'mobile-bar';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.textContent = 'メニュー';
  toggle.setAttribute('aria-controls',sidebar.id); toggle.setAttribute('aria-expanded','false');
  const mobileTitle = document.createElement('span'); mobileTitle.textContent = 'Expense Desk';
  mobileBar.append(toggle,mobileTitle);
  const backdrop = document.createElement('div'); backdrop.className = 'sidebar-backdrop';
  backdrop.setAttribute('aria-hidden','true');
  mount.append(mobileBar,backdrop,sidebar);
  const mobile = matchMedia('(max-width: 800px)');
  let opened = false;
  function setOpen(value, restoreFocus = true) {
    opened = value && mobile.matches;
    document.body.classList.toggle('menu-open',opened);
    toggle.setAttribute('aria-expanded',String(opened));
    sidebar.inert = mobile.matches && !opened;
    for (const element of document.querySelectorAll('main,body>header,body>footer')) element.inert = opened;
    if (opened) { sidebar.setAttribute('role','dialog'); sidebar.setAttribute('aria-modal','true'); close.focus(); }
    else { sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal'); if (restoreFocus && mobile.matches) toggle.focus(); }
  }
  toggle.onclick = () => setOpen(!opened);
  close.onclick = () => setOpen(false);
  backdrop.onclick = () => setOpen(false);
  sidebar.addEventListener('keydown',event => {
    if (!opened) return;
    if (event.key === 'Escape') {event.preventDefault();setOpen(false);return;}
    if (event.key !== 'Tab') return;
    const focusable = [...sidebar.querySelectorAll('a,button,summary')].filter(element => element.getClientRects().length);
    const first = focusable[0], last = focusable[focusable.length-1];
    if (event.shiftKey && document.activeElement === first) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  });
  function markCurrent() {
    const target = page + activeHash;
    for (const link of links) {
      const active = link.getAttribute('href') === target ||
        (!links.some(item => item.getAttribute('href') === target) && link.getAttribute('href') === page);
      if (active) { link.setAttribute('aria-current','page'); const parent = link.closest('details'); if (parent) parent.open = true; }
      else link.removeAttribute('aria-current');
    }
  }
  for (const link of links) link.addEventListener('click',event => {event.preventDefault();window.ReceiptSession.navigate(link.getAttribute('href'));if (opened) setOpen(false);});
  function updateRoute(route){const url=new URL(route,location.href);page=url.pathname.split('/').pop();if(page==='home-content.html')page='index.html';activeHash=url.hash;markCurrent();}
  window.addEventListener('workspace-route',event=>updateRoute(event.detail));
  updateRoute(new URLSearchParams(location.search).get('screen')||'home-content.html');
  mobile.addEventListener('change',() => setOpen(false,false));
  markCurrent(); setOpen(false,false);
})();
