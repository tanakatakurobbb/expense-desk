'use strict';
const SCHEMA=JSON.parse(document.getElementById('schema').textContent);
const expandedItems=new Set();
const manualUnitPrices=new Set();
let lastBulkMode=null;
const classes=['経費','資産・設備','開業費候補','対象外','要確認'];let records=[],selected='',dirty=false,githubDirty=false,typingDirty=false;
let ghToken='',ghBusy=false,ghBaseline=new Map(),ghConnected=false;
let editorRestored=false;
const $=id=>document.getElementById(id),clone=x=>JSON.parse(JSON.stringify(x)),yen=n=>'¥'+n.toLocaleString('ja-JP');
function msg(t,error=false){$('message').textContent=t;$('message').className=error?'error':'';rememberEditor();}
function schemaErrors(value,s=SCHEMA,path='$'){
 let out=[];const err=t=>out.push(path+': '+t),type=Array.isArray(value)?'array':value===null?'null':Number.isInteger(value)?'integer':typeof value;
 if(s.type&&!([s.type].flat().includes(type)||(type==='integer'&&[s.type].flat().includes('number'))))err('型が不正');
 if(s.enum&&!s.enum.includes(value))err('選択値が不正');if('const'in s&&value!==s.const)err('固定値が不正');
 if(typeof value==='number'){if(!Number.isFinite(value))err('有限数が必要');if(s.minimum!=null&&value<s.minimum)err('最小値未満');if(s.maximum!=null&&value>s.maximum)err('最大値超過');if(s.exclusiveMinimum!=null&&value<=s.exclusiveMinimum)err('正数が必要');}
 if(typeof value==='string'){if(s.minLength&&value.length<s.minLength)err('入力が必要');if(s.pattern&&!new RegExp(s.pattern).test(value))err('形式不正');if(s.format==='uuid'&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))err('UUID形式不正');if(s.format==='date'&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))err('日付不正');if(s.format==='date-time'&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))))err('日時不正');}
 if(value&&typeof value==='object'&&!Array.isArray(value)){for(const k of s.required||[])if(!(k in value))err(k+'が必要');if(s.additionalProperties===false)for(const k of Object.keys(value))if(!s.properties?.[k])err(k+'は未対応項目');for(const [k,p]of Object.entries(s.properties||{}))if(k in value)out.push(...schemaErrors(value[k],p,path+'.'+k));}
 if(Array.isArray(value)){if(s.maxItems!=null&&value.length>s.maxItems)err('未解決事項があります');if(s.items)value.forEach((v,i)=>out.push(...schemaErrors(v,s.items,path+'['+i+']')));}
 if(s.anyOf&&!s.anyOf.some(p=>!schemaErrors(value,p,path).length))err('形式不正');for(const p of s.allOf||[])out.push(...schemaErrors(value,p,path));if(s.if&&!schemaErrors(value,s.if,path).length&&s.then)out.push(...schemaErrors(value,s.then,path));return out;
}
function emptyAccounting(){return {expense_class:'要確認',account_candidate:null,review_status:'要確認',purpose:null,project_id:null,business_share:null,reason:null,missing_information:['用途・税務上の処理を確認してください'],reviewed_at:null};}
function current(){return records.find(r=>r.receipt_id===selected);}
function hasGithubChanges(){return typingDirty||(ghConnected?ReceiptEditorModel.pending(records,ghBaseline):githubDirty);}
function updateEditStatus(){
 const pending=hasGithubChanges(),badge=$('edit-indicator');
 badge.textContent=pending?'● GitHubへ未保存の変更あり':ghConnected?'✓ GitHub保存内容と一致':records.length?'GitHub保存状態は未確認':'変更なし';
 badge.className=pending?'edit-pending':'edit-saved';

}
function saveLocal(){dirty=true;githubDirty=true;updateEditStatus();rememberEditor();}
function migrate(r){if(r.schema_version==='0.3')return;r.schema_version='0.3';if(typeof r.is_test!=='boolean')r.is_test=true;r.processing??={processed_at:new Date().toISOString(),rules_version:'未確認（UI移行）',rules_commit:'0'.repeat(40),confirmed_at:null};r.processing.rules_version='未確認（UI移行）';r.processing.rules_commit='0'.repeat(40);r.status='draft';r.processing.confirmed_at=null;r.issues.push('UIでスキーマ0.3へ移行。GitHub保存前に現行ルールの適用確認が必要。');for(const i of r.items)i.accounting??=emptyAccounting();}
function touch(r,facts=false,item=null){
 migrate(r);
 if(facts){
  r.status='draft';
  r.processing.confirmed_at=null;
  // A change to one item must never reset previously reviewed sibling items.
  const affected=item?[item]:r.items;
  for(const i of affected){i.accounting.review_status='要確認';i.accounting.reviewed_at=null;}
 }else if(item){item.accounting.review_status='要確認';item.accounting.reviewed_at=null;}
 saveLocal();
}
function control(tag,label,value,onChange,options={}){const e=document.createElement(tag);e.setAttribute('aria-label',label);if(tag==='select'){for(const v of options.values){const o=document.createElement('option');o.value=v[0];o.textContent=v[1];e.append(o);}}else if(tag==='input'){e.type=options.type||'text';if(options.step)e.step=options.step;}e.value=value??'';e.addEventListener('input',()=>{typingDirty=true;updateEditStatus();});e.addEventListener('change',()=>{typingDirty=false;onChange(e.value);updateEditStatus();});return e;}
function field(label,e){const l=document.createElement('label');l.append(document.createTextNode(label),e);return l;}
function numeric(v){return v===''?null:Number(v);}
function calculatedUnitPrice(item){
 const quantity=item.quantity==null?1:item.quantity;
 if(!Number.isFinite(quantity)||quantity<=0||!Number.isInteger(item.amount))return null;
 const price=item.amount/quantity;
 return Number.isSafeInteger(price)?price:null;
}
function unitPriceKey(r,index){return r.receipt_id+':'+index;}
function isManualUnitPrice(r,i,index){
 const key=unitPriceKey(r,index),auto=calculatedUnitPrice(i);
 return manualUnitPrices.has(key)||(i.unit_price!=null&&i.unit_price!==auto);
}
function changeItemFact(r,i,index,key,value){
 const manual=isManualUnitPrice(r,i,index);
 i[key]=value;
 if((key==='quantity'||key==='amount')&&!manual)i.unit_price=calculatedUnitPrice(i);
 touch(r,true,i);render();
}
function filters(r,i){const a=i.accounting||emptyAccounting(),q=$('search').value.toLowerCase(),fy=r.purchase_date?Number(r.purchase_date.slice(0,4))-(Number(r.purchase_date.slice(5,7))<4?1:0):null;return (!q||[i.name,r.merchant,a.purpose,a.project_id,a.reason].join(' ').toLowerCase().includes(q))&&(!$('class-filter').value||a.expense_class===$('class-filter').value)&&(!$('review-filter').value||a.review_status===$('review-filter').value)&&(!$('year').value||r.purchase_date?.slice(0,4)===$('year').value)&&(!$('fiscal').value||String(fy)===$('fiscal').value);}
function visible(){return ReceiptEditorModel.items(records,$('view-mode').value,selected,filters);}
function updateBulkCount(){
 const category=$('class-filter').value;
 const targets=category?visible():[];
 $('bulk-count').textContent=category?'対象：'+category+' ／ '+targets.length+'品目（'+new Set(targets.map(({r})=>r.receipt_id)).size+'枚）':'対象：上の費用区分を選択してください';
 $('bulk-apply').disabled=!category||targets.length===0;
}
function applyBulkDetail(){
 const category=$('class-filter').value;
 if(!category){msg('一括変更する費用区分を選択してください。',true);return;}
 const targets=visible();
 if(!targets.length){msg('表示中に該当する品目がありません。',true);return;}
 const definitions=[
  ['purpose','bulk-purpose',v=>v.trim()||null],
  ['project_id','bulk-project',v=>v.trim()||null],
  ['account_candidate','bulk-account',v=>v.trim()||null],
  ['business_share','bulk-share',v=>v.trim()===''?null:Number(v)/100],
  ['reason','bulk-reason',v=>v.trim()||null],
  ['missing_information','bulk-missing',v=>v.split('\n').map(s=>s.trim()).filter(Boolean)]
 ];
 const changes={};
 for(const [key,id,convert] of definitions)if($(id+'-on').checked)changes[key]=convert($(id).value);
 if(!Object.keys(changes).length){msg('変更する詳細項目にチェックを入れてください。',true);return;}
 if('business_share' in changes&&changes.business_share!==null&&(!Number.isFinite(changes.business_share)||changes.business_share<0||changes.business_share>1)){msg('事業割合は0〜100%で入力してください。',true);return;}
 const labels={purpose:'用途',project_id:'工事・資産ID',account_candidate:'科目候補',business_share:'事業割合',reason:'判定理由',missing_information:'不足情報'};
 const cleared=Object.entries(changes).filter(([k,v])=>v===null||(Array.isArray(v)&&!v.length)).map(([k])=>labels[k]);
 const receiptCount=new Set(targets.map(({r})=>r.receipt_id)).size;
 const message='費用区分「'+category+'」の表示中 '+targets.length+'品目（'+receiptCount+'枚）へ、'+Object.keys(changes).map(k=>labels[k]).join('・')+'を一括適用します。'+(cleared.length?'\n空欄で消去される項目：'+cleared.join('・'):'')+'\n区分の確認状態は「要確認」に戻ります。実行しますか？';
 if(!confirm(message))return;
 const migrated=new Set();
 for(const {r,i} of targets){
  if(!migrated.has(r.receipt_id)){migrate(r);migrated.add(r.receipt_id);}
  Object.assign(i.accounting,clone(changes));
  i.accounting.review_status='要確認';
  i.accounting.reviewed_at=null;
 }
 saveLocal();render();
 msg(category+' の '+targets.length+'品目に詳細を一括適用しました。必要な品目は個別に修正できます。');
}
$('bulk-apply').onclick=applyBulkDetail;
function render(){
 const viewMode=$('view-mode').value;
 if(viewMode!==lastBulkMode){
  $('bulk-details').open=viewMode!=='single';
  lastBulkMode=viewMode;
 }
 $('single-receipt').hidden=viewMode!=='single';
 const sel=$('receipt');sel.replaceChildren();for(const r of records){const o=document.createElement('option');o.value=r.receipt_id;o.textContent=(r.purchase_date||'日付不明')+'｜'+(r.merchant||'店舗不明')+(r.is_test?' [テスト]':'')+'｜'+r.receipt_id.slice(0,8);const pending=r.items.filter(i=>(i.accounting?.review_status||'要確認')==='要確認'||(i.accounting?.expense_class||'要確認')==='要確認').length;o.textContent+=(pending?' ⚠ 要確認 '+pending+'品目':' ✓ 品目確認済');if(r.issues?.length)o.textContent+=' ／ 読取不明 '+r.issues.length+'件';sel.append(o);}if(!current())selected=records[0]?.receipt_id||'';sel.value=selected;
 const r=current();$('meta').replaceChildren();if(r){for(const [key,label,type] of [['purchase_date','購入日','date'],['merchant','店舗','text'],['total','レシート合計（円）','number'],['tax_total','記載税額（円）','number']])$('meta').append(field(label,control('input',label,r[key],v=>{r[key]=type==='number'?numeric(v):v||null;touch(r,true);render();},{type,step:'1'})));
 $('meta').append(field('テスト区分',control('select','テスト区分',typeof r.is_test==='boolean'?String(r.is_test):'unknown',v=>{r.is_test=v==='true';touch(r,true);render();},{values:[['unknown','区分未確認'],['true','テスト'],['false','実データ']]})));
 $('meta').append(field('レシート備考',control('textarea','レシート備考',r.note,v=>{r.note=v||null;touch(r);render();})));
 $('meta').append(field('読取の不明点（1行1件）',control('textarea','読取の不明点',(r.issues||[]).join('\n'),v=>{r.issues=v.split('\n').filter(Boolean);touch(r,true);render();})));
 const amount=r.items.some(i=>i.amount===null)?null:r.items.reduce((s,i)=>s+i.amount,0);$('receipt-info').textContent='ID: '+r.receipt_id+' / 読取状態: '+r.status+' / 原本: '+(r.source.path||'未保存')+' / 明細合計: '+(amount===null?'不明':yen(amount))+' / レシート合計との差: '+(amount===null||r.total===null?'不明':yen(amount-r.total))+'（税の内外・値引きは原本で確認）';}else $('receipt-info').textContent='レシートがありません。';
 $('rows').replaceChildren();const rows=visible();for(const {r,i,index} of rows){const tr=document.createElement('tr'),a=i.accounting||emptyAccounting(),cell=()=>{const td=document.createElement('td');tr.append(td);return td;};const idcell=cell();idcell.append(document.createTextNode((r.purchase_date||'不明')+'\n'+(r.merchant||'不明')));const tag=document.createElement('div');tag.className='tag';tag.textContent=r.is_test===true?'テスト':r.is_test===false?r.status:'区分未確認';idcell.append(tag);
 for(const [k,type]of [['name','text'],['quantity','number'],['unit_price','number'],['amount','number']]){
  if(k==='unit_price'){
   const td=cell(),manual=isManualUnitPrice(r,i,index),price=control('input','単価（円）',manual?i.unit_price:calculatedUnitPrice(i),v=>{i.unit_price=numeric(v);manualUnitPrices.add(unitPriceKey(r,index));touch(r,true,i);render();},{type:'number',step:'1'});
   price.readOnly=!manual;
   td.append(price);
   const toggle=field('単価を手動入力',document.createElement('input'));const checkbox=toggle.querySelector('input');checkbox.type='checkbox';checkbox.checked=manual;checkbox.setAttribute('aria-label','単価を手動入力');
   checkbox.addEventListener('change',()=>{if(checkbox.checked){manualUnitPrices.add(unitPriceKey(r,index));}else{manualUnitPrices.delete(unitPriceKey(r,index));i.unit_price=calculatedUnitPrice(i);touch(r,true,i);}render();});
   td.append(toggle);
   if(!manual&&calculatedUnitPrice(i)===null&&i.amount!=null){
    const warning=document.createElement('div');warning.className='tag';warning.textContent='割り切れません。原本単価を手動入力';td.append(warning);
   }
  }else cell().append(control('input',k,i[k],v=>changeItemFact(r,i,index,k,type==='number'?numeric(v):v||null),{type,step:k==='quantity'?'any':'1'}));
 }
 cell().append(control('select','税率',i.tax_rate??'',v=>{i.tax_rate=numeric(v);touch(r,true,i);render();},{values:[['','不明'],['0','0%'],['0.08','8%'],['0.1','10%']]}));
 const ac=cell();ac.append(control('select','費用区分',a.expense_class,v=>{migrate(r);i.accounting.expense_class=v;touch(r,false,i);render();},{values:classes.map(v=>[v,v])}),control('input','科目候補',a.account_candidate,v=>{migrate(r);i.accounting.account_candidate=v||null;touch(r,false,i);render();}));
 cell().append(control('input','事業割合',a.business_share==null?'':a.business_share*100,v=>{migrate(r);i.accounting.business_share=v===''?null:Number(v)/100;touch(r,false,i);render();},{type:'number',step:'any'}));
 const purpose=cell();for(const [k,l]of [['purpose','用途'],['project_id','工事・資産ID']])purpose.append(field(l,control('textarea',l,a[k],v=>{migrate(r);i.accounting[k]=v||null;touch(r,false,i);render();})));
 const reason=cell();reason.append(field('判定理由',control('textarea','判定理由',a.reason,v=>{migrate(r);i.accounting.reason=v||null;touch(r,false,i);render();})),field('不足情報（1行1件）',control('textarea','不足情報',a.missing_information.join('\n'),v=>{migrate(r);i.accounting.missing_information=v.split('\n').map(s=>s.trim()).filter(Boolean);touch(r,false,i);render();})));
 const review=cell(),badge=document.createElement('div');badge.className='tag'+(a.review_status==='確認済'?' good':'');badge.textContent=a.review_status;review.append(badge);const b=document.createElement('button');b.textContent=a.review_status==='確認済'?'要確認に戻す':'区分を確認済にする';b.onclick=()=>{migrate(r);const aa=i.accounting;if(aa.review_status==='確認済'){touch(r,false,i);render();return;}const next={...aa,review_status:'確認済',reviewed_at:new Date().toISOString()},errors=schemaErrors(next,SCHEMA.properties.items.items.properties.accounting);if(errors.length){msg('用途・事業割合・判定理由を入力し、不足情報を解消してから確認してください。\n'+errors.join('\n'),true);return;}Object.assign(aa,next);saveLocal();render();msg('品目の費用区分を確認済にしました。読取状態は別途確認が必要です。');};review.append(b);
 const cells=Array.from(tr.children);
 const detailsCell=document.createElement('td');
 detailsCell.dataset.label='詳細';
 const details=document.createElement('details');
 const detailKey=r.receipt_id+':'+index;
 details.open=expandedItems.has(detailKey);
 const summary=document.createElement('summary');
 summary.textContent='詳細・編集';
 details.append(summary);
 const detailGrid=document.createElement('div');
 detailGrid.className='item-detail-grid';
 for(const [position,label] of [[2,'数量'],[3,'単価（円）'],[5,'税率'],[7,'事業割合（%）'],[8,'用途 / 工事・資産ID'],[9,'判定理由 / 不足情報'],[10,'区分確認']]){
   const group=document.createElement('div');
   const title=document.createElement('div');
   title.className='detail-label';
   title.textContent=label;
   group.append(title,...Array.from(cells[position].childNodes));
   detailGrid.append(group);
 }
 const account=ac.querySelector('input');
 detailGrid.append(field('科目候補',account));
 const closeDetail=document.createElement('button');
 closeDetail.type='button';
 closeDetail.textContent='▲ 詳細を閉じる';
 closeDetail.className='detail-close-button';
 closeDetail.setAttribute('aria-label','この品目の詳細を閉じる');
 closeDetail.addEventListener('click',()=>{
   details.open=false;
   expandedItems.delete(detailKey);
   requestAnimationFrame(()=>{
     if(!summary.isConnected)return;
     summary.scrollIntoView({block:'nearest',behavior:'auto'});
   });
 });
 detailGrid.append(closeDetail);
 details.append(detailGrid);
 details.addEventListener('toggle',()=>{
   if(!details.isConnected)return;
   if(details.open)expandedItems.add(detailKey);
   else expandedItems.delete(detailKey);
 });
 detailsCell.append(details);
 tr.replaceChildren(cells[0],cells[1],cells[4],cells[6],detailsCell);
 ['購入日 / 店舗','品名','金額（円）','費用区分','詳細'].forEach((label,n)=>tr.children[n].dataset.label=label);
 const status=document.createElement('div');
 status.className='tag'+(a.review_status==='確認済'?' good':'');
 status.textContent=a.review_status;
 cells[6].append(status);
 $('rows').append(tr);}
 $('count').textContent=records.length+'件';$('pending').textContent=records.reduce((s,r)=>s+r.items.filter(i=>i.accounting?.review_status!=='確認済').length,0)+'件';$('sum').textContent=yen(rows.reduce((s,{i})=>s+(i.amount??0),0))+(rows.some(({i})=>i.amount===null)?' + 不明金額':'');$('empty').hidden=rows.length>0;updateBulkCount();updateEditStatus();rememberEditor();
}
function download(name,data,type){const link=document.createElement('a'),url=URL.createObjectURL(new Blob([data],{type}));link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function validExport(rs){const errors=rs.flatMap(r=>schemaErrors(r).map(e=>r.receipt_id+' '+e));if(errors.length){msg('保存できません。次の入力を修正してください。\n'+errors.join('\n'),true);return false;}return true;}
function exportJSON(one=false){const rs=one?[current()].filter(Boolean):records;if(!rs.length){msg('保存するレシートがありません。',true);return;}if(!validExport(rs))return;const content=one?rs[0]:{format:'azumino-receipt-bundle',version:'1',receipts:rs};download(one?rs[0].receipt_id+'.json':'expense-desk-receipts-'+new Date().toISOString().slice(0,10)+'.json',JSON.stringify(content,null,2),'application/json');if(!one)dirty=false;msg('JSONのダウンロードを開始しました。GitHubへの反映は保存ファイルを経費データの管理者に渡してください。');}
async function importFiles(files){const incoming=[],skipped=[];try{for(const f of files){if(!f.name.endsWith('.json'))continue;const x=JSON.parse(await f.text());if(x.format==='azumino-receipt-bundle'){if(x.version!=='1'||!Array.isArray(x.receipts))throw Error(f.name+': 未対応のバックアップ');incoming.push(...x.receipts);}else if(x.receipt_id)incoming.push(x);else skipped.push(f.name);}if(!incoming.length)throw Error('レシートJSONがありません。');const seen=new Set(records.map(r=>r.receipt_id));for(const r of incoming){const errors=schemaErrors(r);if(errors.length)throw Error(r.receipt_id+'\n'+errors.join('\n'));if(seen.has(r.receipt_id))throw Error('同じレシートIDが既にあります: '+r.receipt_id+'。重複分は追加していません。');seen.add(r.receipt_id);}records.push(...incoming);selected=incoming[0].receipt_id;saveLocal();render();msg(incoming.length+'件を読み込みました。'+(skipped.length?' レシート以外のJSON '+skipped.length+'件を除外。':''));}catch(e){msg('読み込みを中止しました（追加なし）。\n'+e.message,true);}}
function newReceipt(){return {schema_version:'0.3',receipt_id:crypto.randomUUID(),status:'draft',source:{path:null,sha256:null},purchase_date:null,merchant:null,currency:'JPY',total:null,tax_total:null,items:[],issues:['手入力。原本保存と適用ルールの確認が必要。'],note:null,is_test:true,processing:{processed_at:new Date().toISOString(),rules_version:'未確認（UI手入力）',rules_commit:'0'.repeat(40),confirmed_at:null}};}
function newItem(){return {name:null,quantity:null,unit_price:null,amount:null,tax_rate:null,accounting:emptyAccounting()};}
$('new').onclick=()=>{const r=newReceipt();r.items.push(newItem());records.push(r);selected=r.receipt_id;saveLocal();render();msg('新しいレシートを追加しました。初期設定はテストです。');};
$('add').onclick=()=>{const r=current();if(!r)return;touch(r,true);r.items.push(newItem());saveLocal();render();};
$('demo').onclick=()=>{const r=newReceipt();r.purchase_date='2026-10-01';r.merchant='架空のホームセンター';r.total=23400;r.note='すべて架空の操作テスト。実経費に含めない。';r.items=[{...newItem(),name:'インパクトドライバー',quantity:1,unit_price:19800,amount:19800,tax_rate:0.1,accounting:{...emptyAccounting(),account_candidate:'消耗品費／工具器具備品',reason:'工具の用途・取得単位・処理方針が未確認。',missing_information:['事業での使用割合','取得単位と会計処理方針']}},{...newItem(),name:'床材',quantity:2,unit_price:1800,amount:3600,tax_rate:0.1,accounting:{...emptyAccounting(),project_id:'床改修-01',reason:'修繕か改良かを工事全体で確認する。',missing_information:['工事目的・施工範囲・工事総額']}}];records.push(r);selected=r.receipt_id;saveLocal();render();};
for(const id of ['import','folder'])$(id).onchange=async e=>{await importFiles(e.target.files);e.target.value='';};
$('receipt').onchange=e=>{selected=e.target.value;render();};for(const id of ['search','class-filter','review-filter','year','fiscal','view-mode'])$(id).addEventListener('input',render);
$('backup').onclick=()=>exportJSON();$('one').onclick=()=>exportJSON(true);
$('csv').onclick=()=>{if(!validExport(records))return;const esc=v=>'"'+String(v??'').replace(/^[=+\-@\t\r]/,"'$&").replace(/"/g,'""')+'"';const rows=[['レシートID','購入日','店舗','読取状態','テスト区分','品名','数量','単価','金額','税率','費用区分','科目候補','区分確認','事業割合','用途','工事・資産ID','理由','不足情報'],...visible().map(({r,i})=>{const a=i.accounting||emptyAccounting();return[r.receipt_id,r.purchase_date,r.merchant,r.status,r.is_test??'不明',i.name,i.quantity,i.unit_price,i.amount,i.tax_rate,a.expense_class,a.account_candidate,a.review_status,a.business_share,a.purpose,a.project_id,a.reason,a.missing_information.join(' / ')];})];download('expense-desk-items.csv','\uFEFF'+rows.map(r=>r.map(esc).join(',')).join('\r\n'),'text/csv;charset=utf-8');msg('表示中の品目をCSV保存しました。CSVは確認用で、JSONが編集データの正本です。');};
$('clear').onclick=()=>{if(!confirm('保存していない作業も消去されます。全件JSONを保存済みですか？'))return;records=[];selected='';dirty=false;githubDirty=false;typingDirty=false;render();msg('画面の作業データを消去しました。GitHub上のデータは変更していません。');};
$('view-mode').value=new URLSearchParams(location.search).has('receipt')?'single':'all';
render();

function ghStatus(s){$('gh-status').textContent=s;}
function ghLock(lock,operation=''){ghBusy=lock;$('gh-load').textContent=lock&&operation==='load'?'読込中…':'GitHubから読み込む';$('gh-save').textContent=lock&&operation==='save'?'保存中…':'変更をGitHubへ保存';document.querySelector('.workspace-dock').setAttribute('aria-busy',String(lock));for(const e of document.querySelectorAll('button,input,select,textarea'))e.disabled=lock;}
async function ghAPI(path,method='GET',body){const response=await fetch(ReceiptData.apiUrl(await ReceiptSession.getRepository(),path),{method,headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+ghToken,'X-GitHub-Api-Version':'2022-11-28',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',redirect:'error'});if(!response.ok){const explain={401:'トークンが無効、または期限切れです。',403:'権限不足、ブランチ制限、またはAPI制限です。',404:'リポジトリへのアクセス権か保存先を確認してください。',409:'GitHub側が更新されています。再読み込みして変更を確認してください。',422:'競合または入力条件により保存できません。'};throw Error('GitHub '+response.status+'：'+(explain[response.status]||'処理に失敗しました。'));}return response.json();}
function decodeBlob(blob){if(blob.encoding!=='base64')throw Error('未対応のGitHubファイル形式');const bytes=Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c=>c.charCodeAt(0));return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
async function ghSnapshot(){const head=await ghAPI('/git/ref/heads/main'),commit=await ghAPI('/git/commits/'+head.object.sha),tree=await ghAPI('/git/trees/'+commit.tree.sha+'?recursive=1');if(tree.truncated)throw Error('ファイル一覧が途中で切れたため、読込・保存を中止しました。');return {head:head.object.sha,tree:commit.tree.sha,entries:tree.tree,updatedAt:commit.committer?.date||commit.author?.date||null};}
async function ghReadJSON(entry){return JSON.parse(decodeBlob(await ghAPI('/git/blobs/'+entry.sha)));}
function changedRemote(){return ReceiptEditorModel.changed(records,ghBaseline);}
async function loadGithub(){if(ghBusy)return;ghToken=await ReceiptSession.getToken();if(ghBusy)return;if(!ghToken){msg('左メニューのGitHub接続で、先に接続してください。',true);return;}if(records.length&&!confirm('現在の画面データをGitHubのデータに置き換えます。未保存の変更がある場合はキャンセルしてください。'))return;ghLock(true,'load');msg('GitHubから読込中…');ReceiptSession.patch({operation:'読込中',error:null});try{ghStatus('GitHubから読込中…');const snap=await ghSnapshot(),scope=$('gh-scope').value,entries=snap.entries.filter(e=>e.type==='blob'&&e.path.endsWith('.json')&&((scope!=='tests'&&e.path.startsWith('data/'))||(scope!=='data'&&e.path.startsWith('tests/'))));const next=[],bases=new Map();for(const entry of entries){const r=await ghReadJSON(entry);if(!r.receipt_id)continue;const errors=schemaErrors(r);if(errors.length)throw Error(entry.path+'：JSON形式の検証に失敗しました。'+errors.join(' / '));if(bases.has(r.receipt_id))throw Error('同じIDが複数の保存先にあります：'+r.receipt_id);if(entry.path.startsWith('tests/')&&r.is_test===false)throw Error('テストフォルダ内の実データ区分を確認してください：'+entry.path);next.push(r);bases.set(r.receipt_id,{path:entry.path,sha:entry.sha,json:JSON.stringify(r),original:clone(r)});}records=next;selected=next.find(r=>r.receipt_id===new URLSearchParams(location.search).get('receipt'))?.receipt_id||next[0]?.receipt_id||'';ghBaseline=bases;ghConnected=true;saveLocal();dirty=false;render();ghStatus('読込成功 · '+records.length+'件 · コミット '+snap.head.slice(0,8));ReceiptSession.patch({connection:'接続成功',operation:'読込成功',loadedAt:new Date().toISOString(),updatedAt:snap.updatedAt,count:records.length,scope,error:null});msg('GitHubから直接読み込みました。編集後は「変更をGitHubへ保存」を押してください。');}catch(e){msg('GitHub読込に失敗しました。現在の画面データは維持しています。\n'+e.message,true);ghStatus('読込失敗');ReceiptSession.patch({operation:'読込失敗',error:e.message});}finally{ghLock(false);}}
async function saveGithub(){if(ghBusy)return;ghToken=await ReceiptSession.getToken();if(ghBusy)return;if(!ghConnected||!ghToken){msg('先にGitHubから読み込んでください。',true);return;}const changed=changedRemote();if(!changed.length){msg('GitHubから読み込んだレシートに変更がありません。新規・ローカル読込データの登録は経費データの管理者へ依頼してください。');return;}const reason=$('gh-reason').value.trim();if(!reason){msg('変更理由を入力してください。',true);return;}if(!validExport(changed))return;
const frozen=changed.map(r=>clone(r));for(const r of frozen){const original=ghBaseline.get(r.receipt_id).original;if(r.purchase_date!==original.purchase_date||(typeof original.is_test==='boolean'&&r.is_test!==original.is_test)||JSON.stringify(r.source)!==JSON.stringify(original.source)){msg('購入日・テスト区分・原本の変更は保存先の移動や照合が必要です。経費データの管理者へ依頼してください。',true);return;}}
ghLock(true,'save');msg('GitHubへ保存中…');ReceiptSession.patch({operation:'保存中',error:null});let committed=false;try{ghStatus('競合・適用ルールを確認中…');const snap=await ghSnapshot();for(const r of frozen){const base=ghBaseline.get(r.receipt_id),entry=snap.entries.find(e=>e.path===base.path);if(!entry||entry.sha!==base.sha)throw Error(base.path+' が他で変更されました。画面のJSONをバックアップしてから再読込し、差分を確認してください。');}
const rule=snap.entries.find(e=>e.path==='docs/receipt-processing.md');if(!rule)throw Error('処理ルールがありません。');const rules=decodeBlob(await ghAPI('/git/blobs/'+rule.sha)),version=rules.match(/ルールバージョン：([^\s]+)/)?.[1];if(version!=='0.5')throw Error('処理ルールが更新されています。最新HTMLへ更新してください。');
const updated=frozen.map(originalFrozen=>{const r=clone(originalFrozen);const old=ghBaseline.get(r.receipt_id).original;if(r.schema_version!==old.schema_version||r.processing?.rules_commit==='0'.repeat(40)){migrate(r);r.processing.rules_version=version;r.processing.rules_commit=snap.head;r.processing.processed_at=new Date().toISOString();r.status='draft';r.processing.confirmed_at=null;}return r;});if(!validExport(updated))throw Error('更新データの検証に失敗しました。');
const tree=await ghAPI('/git/trees','POST',{base_tree:snap.tree,tree:updated.map(r=>({path:ghBaseline.get(r.receipt_id).path,mode:'100644',type:'blob',content:JSON.stringify(r,null,2)+'\n'}))});const commit=await ghAPI('/git/commits','POST',{message:'経費訂正：'+reason,tree:tree.sha,parents:[snap.head]});await ghAPI('/git/refs/heads/main','PATCH',{sha:commit.sha,force:false});committed=true;
const resultTree=await ghAPI('/git/trees/'+tree.sha+'?recursive=1');if(resultTree.truncated)throw Error('保存後の一覧確認が途中で切れました。');for(const saved of updated){const base=ghBaseline.get(saved.receipt_id),entry=resultTree.tree.find(e=>e.path===base.path);if(!entry)throw Error('保存ファイルを読み戻せません。');const back=await ghReadJSON(entry);if(JSON.stringify(back)!==JSON.stringify(saved))throw Error('保存後の読み戻しが一致しません。');const live=records.find(r=>r.receipt_id===saved.receipt_id);if(JSON.stringify(live)===JSON.stringify(frozen.find(r=>r.receipt_id===saved.receipt_id)))Object.assign(live,clone(saved));ghBaseline.set(saved.receipt_id,{...base,sha:entry.sha,json:JSON.stringify(saved),original:clone(saved)});}saveLocal();dirty=changedRemote().length>0;render();ghStatus('保存成功 · '+updated.length+'件 · コミット '+commit.sha.slice(0,8));ReceiptSession.patch({operation:'保存成功',updatedAt:commit.committer?.date||null,error:null});msg('GitHubへ'+updated.length+'件を保存し、読み戻し一致を確認しました。'+(dirty?' 保存中に追加された変更があります。再度保存してください。':''));
}catch(e){msg((committed?'GitHub書込済みですが、読み戻し検証が未完了です。再保存前に最新データを確認してください。':'GitHub保存を完了できませんでした。編集内容は画面に残っています。')+'\n'+e.message,true);ghStatus(committed?'書込済み・検証未完了':'保存未完了');ReceiptSession.patch({operation:committed?'書込済み・検証未完了':'保存失敗',error:e.message});}finally{ghLock(false);}}
$('gh-load').onclick=loadGithub;$('gh-save').onclick=saveGithub;
window.addEventListener('receipt-connection',event=>{if(event.detail.connection!=='接続成功'){githubDirty=hasGithubChanges();ghToken='';ghConnected=false;ghBaseline.clear();updateEditStatus();}});


const editorFields=['view-mode','search','class-filter','review-filter','year','fiscal','gh-scope','gh-reason'];
function rememberEditor(){
 if(!editorRestored || !window.ReceiptSession)return;
 ReceiptSession.setWorkspace('editor',{records,selected,dirty,githubDirty,pending:hasGithubChanges(),baseline:[...ghBaseline],connected:ghConnected,fields:Object.fromEntries(editorFields.map(id=>[id,$(id).value])),expanded:[...expandedItems],status:$('gh-status').textContent});
}
async function restoreEditor(){
 const snapshot=await ReceiptSession.workspace('editor');
 if(snapshot){
  records=snapshot.records;selected=snapshot.selected;dirty=snapshot.dirty;githubDirty=snapshot.githubDirty;ghBaseline=new Map(snapshot.baseline);ghConnected=snapshot.connected;
  for(const [id,value]of Object.entries(snapshot.fields))$(id).value=value;
  for(const key of snapshot.expanded)expandedItems.add(key);
  const requested=new URLSearchParams(location.search).get('receipt');
  if(requested){selected=records.find(r=>r.receipt_id===requested)?.receipt_id||selected;$('view-mode').value='single';}
  $('message').textContent='';$('message').className='';$('gh-status').textContent=snapshot.status;
 }
 editorRestored=true;render();
}
for(const id of ['gh-reason','gh-scope'])$(id).addEventListener('input',rememberEditor);
if(window.ReceiptSession)restoreEditor();else window.addEventListener('receipt-session-api',restoreEditor,{once:true});
