'use strict';
const D = window.ReceiptData;
const $ = id => document.getElementById(id);
const yen = value => '¥' + value.toLocaleString('ja-JP');
let records = [], entries = [], hasData = false, imageVersion = 0, summaryRestored = false;
function message(text, error = false) {
  $('status').textContent = text;
  $('status').className = 'status-message' + (error ? ' error' : '');
  if(error){
    $('summary-connection-details').open=true;
    $('summary-load-indicator').textContent='⚠ 読み込み・集計を確認';
  }
}
function closeSummaryFold(id){
  const details=$(id);
  details.open=false;
  const summary=details.querySelector(':scope > summary');
  if(summary)requestAnimationFrame(()=>{if(summary.isConnected)summary.scrollIntoView({block:'nearest',behavior:'auto'});});
}
function syncSummaryStickyHeader(){
  const dock=document.querySelector('.summary-dock');
  if(dock)document.documentElement.style.setProperty('--summary-sticky-top',Math.ceil(dock.getBoundingClientRect().height+8)+'px');
}
function cell(row, label, value) {
  const td = document.createElement('td');
  td.dataset.label = label;
  if (value instanceof Node) td.append(value);
  else td.textContent = value;
  row.append(td);
}
function filters() {
  return {start:$('start').value,end:$('end').value,keyword:$('keyword').value,
    expenseClass:$('expense').value,scope:$('data-scope').value};
}
function render() {
  imageVersion++;
  $('detail').hidden = true;
  const f = filters();
  const scopeLabels={data:'実データ',tests:'テスト',both:'実データとテスト'};
  const context='購入期間 '+(f.start||'指定なし')+' 〜 '+(f.end||'指定なし')+' ／ キーワード '+(f.keyword.trim()||'すべて')+' ／ 費用区分 '+(f.expenseClass||'すべて')+' ／ '+scopeLabels[f.scope];
  $('active-filters').textContent=context;
  for(const element of document.querySelectorAll('[data-filter-context]'))element.textContent=context;
  if (!hasData) {rememberSummary();return;}
  const invalid = f.start && f.end && f.start > f.end;
  const rows = invalid ? [] : D.findItems(records,f);
  const totals = D.summarize(rows);
  if (invalid) message('終了日は開始日以降を指定してください。',true);
  else message('');
  $('receipt-count').textContent = totals.receipts.length + '枚';
  $('item-count').textContent = rows.length + '品目';
  $('item-total').textContent = yen(totals.itemTotal);
  $('receipt-total').textContent = yen(totals.receiptTotal);
  $('item-unknown').textContent = totals.unknownItems ? '金額不明 '+totals.unknownItems+'品目を除く' : 'レシート記載の明細金額';
  $('receipt-unknown').textContent = totals.unknownReceipts ? '合計不明 '+totals.unknownReceipts+'枚を除く' : '1枚につき合計金額を1回集計';
  $('groups').replaceChildren();
  for (const group of D.groupItems(rows,$('group').value)) {
    const tr = document.createElement('tr');
    cell(tr,'集計対象',group.name); cell(tr,'品目数',group.count+'品目');
    cell(tr,'明細金額合計',yen(group.total)+(group.unknown ? '（不明 '+group.unknown+'品目）' : ''));
    $('groups').append(tr);
  }
  $('receipts').replaceChildren();
  const counts = new Map();
  for (const row of rows) counts.set(row.receipt.receipt_id,(counts.get(row.receipt.receipt_id)||0)+1);
  for (const receipt of totals.receipts.sort((a,b) => (b.purchase_date||'').localeCompare(a.purchase_date||''))) {
    const tr = document.createElement('tr');
    cell(tr,'購入日',receipt.purchase_date||'不明');
    cell(tr,'店舗',(receipt.merchant||'不明')+(receipt.is_test ? '（テスト）' : ''));
    cell(tr,'該当品目数',counts.get(receipt.receipt_id)+'品目');
    cell(tr,'レシート合計',receipt.total == null ? '不明' : yen(receipt.total));
    const button = document.createElement('button');
    button.className = 'secondary receipt-detail-button'; button.textContent = '原本・明細';
    button.onclick = () => showDetail(receipt);
    cell(tr,'内容確認',button); $('receipts').append(tr);
  }
  $('empty').textContent = totals.receipts.length ? '' : '条件に合うレシートがありません。読込対象や検索条件を確認してください。';
  rememberSummary();
}
function showDetail(receipt) {
  imageVersion++;
  const version = imageVersion;
  const root = $('detail-body'); root.replaceChildren();
  $('detail-title').textContent = (receipt.merchant||'店舗不明')+'のレシート';
  const meta = document.createElement('p'); meta.className = 'subtle';
  meta.textContent = (receipt.purchase_date||'日付不明')+' · '+(receipt.total == null ? '合計不明' : yen(receipt.total))+' · 読取状態 '+receipt.status+' · ID '+receipt.receipt_id;
  root.append(meta);
  const edit = document.createElement('a'); edit.className = 'button-link';
  edit.href = 'editor.html?receipt='+encodeURIComponent(receipt.receipt_id);
  edit.textContent = 'このレシートを編集'; root.append(edit);
  const instruction = document.createElement('p'); instruction.className = 'subtle';
  instruction.textContent = '編集画面でGitHubから読み込むと、このレシートを選択します。'; root.append(instruction);
  const layout = document.createElement('div'); layout.className = 'detail-layout';
  const imageBox = document.createElement('div');
  const imageButton = document.createElement('button'); imageButton.className = 'secondary'; imageButton.textContent = '原本画像を表示';
  const imageStatus = document.createElement('p'); imageStatus.className = 'subtle';
  imageBox.append(imageButton,imageStatus);
  imageButton.onclick = async () => {
    const currentToken = await ReceiptSession.getToken();
    if (!currentToken) {imageStatus.textContent = '左メニューのGitHub接続で接続してください。';return;}
    imageButton.disabled = true; imageStatus.textContent = '原本を読み込み中…';
    try {
      const path = receipt.source?.path;
      const types = {jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif'};
      const mime = types[path?.split('.').pop().toLowerCase()];
      if (!path || !mime || !/^(receipts|tests\/receipts)\//.test(path) || path.split('/').includes('..')) throw new Error('表示可能な原本画像の保存先がありません。');
      const entry = entries.find(e => e.path === path);
      const blob = entry ? await D.request('/git/blobs/'+entry.sha,currentToken) :
        await D.request('/contents/'+path.split('/').map(encodeURIComponent).join('/')+'?ref=main',currentToken);
      if (blob.encoding !== 'base64' || !blob.content) throw new Error('画像の取得形式を確認してください。');
      if (version !== imageVersion) return;
      const image = document.createElement('img'); image.className = 'receipt-image'; image.alt = (receipt.merchant||'')+'のレシート原本';
      image.src = 'data:'+mime+';base64,'+blob.content.replace(/\s/g,'');
      imageBox.append(image); imageStatus.textContent = ''; imageButton.hidden = true;
    } catch (error) {imageStatus.textContent = error.message;}
    finally {imageButton.disabled = false;}
  };
  const itemsBox = document.createElement('div');
  const table = document.createElement('table'); table.className = 'responsive-table';
  const head = document.createElement('thead'); const header = document.createElement('tr');
  for (const name of ['品名','明細金額','費用区分']) {const th=document.createElement('th');th.textContent=name;header.append(th);}
  head.append(header); table.append(head);
  const body = document.createElement('tbody');
  for (const item of receipt.items) {
    const tr = document.createElement('tr');cell(tr,'品名',item.name||'不明');
    cell(tr,'明細金額',item.amount == null ? '不明' : yen(item.amount));
    cell(tr,'費用区分',D.accounting(item).expense_class); body.append(tr);
  }
  table.append(body); itemsBox.append(table);
  const notes = document.createElement('p'); notes.className = 'subtle';
  notes.textContent = [receipt.note,...(receipt.issues||[])].filter(Boolean).join('\n'); notes.style.whiteSpace = 'pre-wrap'; itemsBox.append(notes);
  layout.append(imageBox,itemsBox);root.append(layout);$('detail').hidden=false;$('detail').scrollIntoView({block:'start'});
}
$('load').onclick = async () => {
  const inputToken = await ReceiptSession.getToken();
  if (!inputToken) {message('左メニューのGitHub接続で接続してください。',true);return;}
  if($('load').disabled)return;
  $('load').disabled = true; $('load').textContent='読込中…';$('data-scope').disabled = true;document.querySelector('.workspace-dock').setAttribute('aria-busy','true');
  message('GitHubから読み込んでいます…');
  ReceiptSession.patch({operation:'読込中',error:null});
  try {
    const scope = $('data-scope').value;
    const result = await D.loadGithub(inputToken,scope);
    records=result.records;entries=result.entries;hasData=true;
    $('source-status').textContent='GitHubから取得 · '+records.length+'枚 · '+new Date().toLocaleString()+' · コミット '+result.commit.slice(0,8);
    $('summary-load-indicator').textContent='✓ 読込済 '+records.length+'枚';
    render();
    ReceiptSession.patch({connection:'接続成功',operation:'読込成功',loadedAt:new Date().toISOString(),updatedAt:result.updatedAt,count:records.length,scope,error:null});
  } catch (error) {message('読込に失敗しました。'+error.message,true);ReceiptSession.patch({operation:'読込失敗',error:error.message});}
  finally {$('load').disabled=false;$('load').textContent='GitHubから読み込む';$('data-scope').disabled=false;document.querySelector('.workspace-dock').setAttribute('aria-busy','false');}
};
for(const id of ['start','end','keyword','expense','group','data-scope'])$(id).addEventListener('input',render);
function closeReceiptDetail(){
  imageVersion++;
  $('detail').hidden=true;
  document.getElementById('receipt-list').scrollIntoView({block:'nearest',behavior:'auto'});
}
$('close-detail').onclick=closeReceiptDetail;
$('close-detail-bottom').onclick=closeReceiptDetail;
$('summary-connection-close').onclick=()=>closeSummaryFold('summary-connection-details');
$('summary-notes-close').onclick=()=>closeSummaryFold('summary-notes');
if(typeof ResizeObserver!=='undefined')new ResizeObserver(syncSummaryStickyHeader).observe(document.querySelector('.summary-dock'));
window.addEventListener('resize',syncSummaryStickyHeader);
syncSummaryStickyHeader();

render();

const summaryFields=['start','end','keyword','expense','group','data-scope'];
function rememberSummary(){
 if(!summaryRestored || !window.ReceiptSession)return;
 ReceiptSession.setWorkspace('summary',{records,entries,hasData,fields:Object.fromEntries(summaryFields.map(id=>[id,$(id).value])),source:$('source-status').textContent});
}
async function restoreSummary(){
 const snapshot=await ReceiptSession.workspace('summary');
 if(snapshot){records=snapshot.records;entries=snapshot.entries;hasData=snapshot.hasData;for(const[id,value]of Object.entries(snapshot.fields))$(id).value=value;$('source-status').textContent=snapshot.source;}
 $('summary-connection-details').open=false;
 $('summary-notes').open=false;
 if(hasData)$('summary-load-indicator').textContent='✓ 読込済 '+records.length+'枚';
 summaryRestored=true;render();
}
if(window.ReceiptSession)restoreSummary();else window.addEventListener('receipt-session-api',restoreSummary,{once:true});
