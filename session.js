'use strict';
(() => {
  const channel = 'expense-desk-session';
  const origin = location.origin;
  const shell = document.body.hasAttribute('data-workspace-shell');
  const allowed = ['home-content.html','editor.html','summary.html','connection.html'];
  const empty = () => ({token:'',repository:'',connection:'未接続',operation:'未実行',checkedAt:null,loadedAt:null,updatedAt:null,count:null,scope:null,error:null});
  function validateRoute(route) {
    if (typeof route !== 'string') return null;
    const match = route.match(/^([^?#]+)([?#].*)?$/);
    const name = match?.[1] === 'index.html' ? 'home-content.html' : match?.[1];
    return allowed.includes(name) ? name + (match[2] || '') : null;
  }
  if (shell) {
    const frame = document.getElementById('workspace-content');
    let state = empty();
    let workspaces = {};
    let frameReady=false,pendingRoute=null;
    const send = () => frame.contentWindow?.postMessage({channel,type:'state',state},origin);
    function openRoute(valid){
      state.error=null;
      frameReady=false;pendingRoute=null;
      frame.src = valid;
      const url = new URL(location.href);
      url.searchParams.set('screen',valid);
      history.replaceState(null,'',url);
      window.dispatchEvent(new CustomEvent('workspace-route',{detail:valid}));
    }
    function navigate(route){
      const valid=validateRoute(route);
      if(!valid || state.operation.endsWith('中'))return;
      if(frameReady){pendingRoute=valid;frame.contentWindow.postMessage({channel,type:'capture'},origin);}
      else openRoute(valid);
    }
    window.ReceiptSession = {navigate};
    window.addEventListener('message',event => {
      if (event.origin !== origin || event.source !== frame.contentWindow || event.data?.channel !== channel) return;
      const message = event.data;
      if (message.type === 'get') {frameReady=true;send();}
      if(message.type==='navigate-ready' && pendingRoute)openRoute(pendingRoute);
      if (message.type === 'connect' && typeof message.token === 'string') {
        workspaces = {};
        state = {...empty(),token:message.token,repository:message.repository,connection:'接続成功',checkedAt:message.checkedAt,updatedAt:message.updatedAt}; send();
      }
      if (message.type === 'patch') {
        for (const key of ['connection','operation','loadedAt','updatedAt','count','scope','error']) {
          if (Object.hasOwn(message.values||{},key)) state[key] = message.values[key];
        }
        send();
      }
      if (message.type === 'clear') {state=empty();workspaces={};send();}
      if(message.type==='workspace-set' && ['editor','summary'].includes(message.name)) workspaces[message.name]=message.snapshot;
      if(message.type==='workspace-get' && ['editor','summary'].includes(message.name)) frame.contentWindow.postMessage({channel,type:'workspace',name:message.name,snapshot:workspaces[message.name]||null},origin);
      if (message.type === 'navigate') navigate(message.route);
    });
    window.addEventListener('beforeunload',event=>{if(workspaces.editor?.pending){event.preventDefault();event.returnValue='';}});
    frame.addEventListener('load',send);
    const route = new URLSearchParams(location.search).get('screen') || 'home-content.html';
    navigate(validateRoute(route) || 'home-content.html');
    return;
  }
  if (window.parent === window) {
    const file = location.pathname.split('/').pop();
    location.replace('index.html?screen='+encodeURIComponent(file+location.search+location.hash));
    return;
  }
  document.body.classList.add('embedded-page');
  const noticeNodes=['message','status','connection-result'].map(id=>document.getElementById(id)).filter(Boolean);
  function dismissErrors(){
    for(const node of noticeNodes)if(node.classList.contains('error')){node.textContent='';node.classList.remove('error');}
    state.error=null;post('patch',{values:{error:null}});
    window.rememberEditor?.();
  }
  for(const node of noticeNodes){
    const button=document.createElement('button');
    button.type='button';button.className='secondary dismiss-error';button.textContent='確認して閉じる';button.hidden=true;
    button.onclick=dismissErrors;node.after(button);
    const update=()=>{button.hidden=!(node.classList.contains('error')&&node.textContent.trim());};
    new MutationObserver(update).observe(node,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});update();
  }

  let state = empty(), resolveReady;
  const workspaceWaiters=new Map();
  const ready = new Promise(resolve => {resolveReady=resolve;});
  function post(type,values={}) {window.parent.postMessage({channel,type,...values},origin);}
  function renderStatus() {
    const mount = document.getElementById('connection-status');
    if (!mount) return;
    mount.replaceChildren();
    mount.className = 'connection-status '+(state.operation.includes('失敗')||state.operation.includes('未完了')||state.connection==='接続失敗'?'failed':'');
    mount.setAttribute('aria-busy',String(state.operation.endsWith('中')));
    const line = document.createElement('strong');
    const scopeLabels={data:'実データ',tests:'テスト',both:'実データとテスト'};
    line.textContent = state.connection+' · 直近の処理 '+state.operation+(state.count != null ? ' · '+state.count+'枚（'+(scopeLabels[state.scope]||'対象未指定')+'）' : '');
    mount.append(line);
    for(const summary of document.querySelectorAll('[data-connection-summary]'))summary.textContent=state.connection+' · '+state.operation;
    const time = value => value ? new Date(value).toLocaleString() : '未確認';
    const dates = document.createElement('div');
    dates.textContent='最終読込成功 '+time(state.loadedAt)+' ／ GitHub最終更新（リポジトリ） '+time(state.updatedAt);
    dates.className='connection-dates';mount.append(dates);
    if (state.error) {const error=document.createElement('div');error.textContent=state.error;mount.append(error);const close=document.createElement('button');close.type='button';close.className='secondary dismiss-error';close.textContent='確認して閉じる';close.onclick=dismissErrors;mount.append(close);}
    const link=document.createElement('a');link.href='connection.html';link.textContent='GitHub接続を設定';mount.append(link);
  }
  window.addEventListener('message',event=>{
    if(event.origin!==origin || event.source!==window.parent || event.data?.channel!==channel)return;
    if(event.data.type==='capture'){document.activeElement?.blur();dismissErrors();window.rememberEditor?.();window.rememberSummary?.();post('navigate-ready');return;}
    if(event.data.type==='workspace'){const resolve=workspaceWaiters.get(event.data.name);if(resolve){workspaceWaiters.delete(event.data.name);resolve(event.data.snapshot);}return;}
    if(event.data.type!=='state')return;
    state=event.data.state;resolveReady();renderStatus();
    window.dispatchEvent(new CustomEvent('receipt-connection',{detail:{...state,token:undefined}}));
  });
  window.ReceiptSession = {
    async getRepository(){await ready;return state.repository;},
    async getToken(){await ready;return state.token;},
    async workspace(name){await ready;return new Promise(resolve=>{workspaceWaiters.set(name,resolve);post('workspace-get',{name});});},
    setWorkspace(name,snapshot){post('workspace-set',{name,snapshot});},
    patch(values){post('patch',{values});},
    connect(token,repository,checkedAt,updatedAt){post('connect',{token,repository,checkedAt,updatedAt});},
    clear(){post('clear');},
    navigate(route){post('navigate',{route});}
  };
  window.dispatchEvent(new Event('receipt-session-api'));
  document.addEventListener('click',event=>{
    const link=event.target.closest('a[href]');
    if (!link || link.target === '_blank' || link.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const route=validateRoute(link.getAttribute('href'));
    if (route) {event.preventDefault();post('navigate',{route});}
  });
  post('get');
})();
