/* Shared, read-only filtering and GitHub data access. */
'use strict';
window.ReceiptData = (() => {
  const accounting = item => item.accounting || {expense_class:'要確認',review_status:'要確認'};
  function findItems(records, filters) {
    const keyword = (filters.keyword || '').trim().toLocaleLowerCase();
    return records.flatMap(receipt => {
      if (filters.scope === 'data' && receipt.is_test !== false) return [];
      if (filters.scope === 'tests' && receipt.is_test !== true) return [];
      if (filters.start && (!receipt.purchase_date || receipt.purchase_date < filters.start)) return [];
      if (filters.end && (!receipt.purchase_date || receipt.purchase_date > filters.end)) return [];
      return receipt.items.flatMap(item => {
        const a = accounting(item);
        if (filters.expenseClass && a.expense_class !== filters.expenseClass) return [];
        if (filters.pending && a.review_status === '確認済') return [];
        const text = [receipt.receipt_id,receipt.merchant,item.name,a.purpose,a.project_id,a.account_candidate].join(' ').toLocaleLowerCase();
        return keyword && !text.includes(keyword) ? [] : [{receipt,item}];
      });
    });
  }
  function summarize(rows) {
    const receipts = [...new Map(rows.map(row => [row.receipt.receipt_id,row.receipt])).values()];
    return {
      receipts,
      itemTotal: rows.reduce((sum,row) => sum + (row.item.amount ?? 0),0),
      receiptTotal: receipts.reduce((sum,r) => sum + (r.total ?? 0),0),
      unknownItems: rows.filter(row => row.item.amount == null).length,
      unknownReceipts: receipts.filter(r => r.total == null).length
    };
  }
  function groupItems(rows, by) {
    const groups = new Map();
    for (const {receipt,item} of rows) {
      const a = accounting(item);
      const labels = {month:receipt.purchase_date?.slice(0,7),merchant:receipt.merchant,expense:a.expense_class,project:a.project_id};
      const key = labels[by] || '未設定';
      const group = groups.get(key) || {name:key,count:0,total:0,unknown:0};
      group.count++;
      group.total += item.amount ?? 0;
      if (item.amount == null) group.unknown++;
      groups.set(key,group);
    }
    return [...groups.values()].sort((a,b) => a.name.localeCompare(b.name,'ja'));
  }
  function apiUrl(repository, path) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        /\/(?:\.|\.\.)$/.test(repository)) {
      throw new Error('接続先を owner/repository の形式で入力してください。');
    }
    return 'https://api.github.com/repos/' + repository + path;
  }
  async function request(path, token, repository) {
    repository ??= await ReceiptSession.getRepository();
    const response = await fetch(apiUrl(repository, path),{headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+token},cache:'no-store',redirect:'error'});
    if (!response.ok) throw new Error('GitHub '+response.status+'。トークンの期限・対象リポジトリ・権限を確認してください。');
    return response.json();
  }
  function decode(blob) {
    if (blob.encoding !== 'base64') throw new Error('未対応のファイル形式です。');
    return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(blob.content.replace(/\s/g,'')),c => c.charCodeAt(0)));
  }
  async function loadGithub(token, scope) {
    const head = await request('/git/ref/heads/main',token);
    const commit = await request('/git/commits/'+head.object.sha,token);
    const tree = await request('/git/trees/'+commit.tree.sha+'?recursive=1',token);
    if (tree.truncated) throw new Error('ファイル一覧が途中で切れました。');
    const entries = tree.tree.filter(e => e.type === 'blob' && e.path.endsWith('.json') &&
      ((scope !== 'tests' && e.path.startsWith('data/')) || (scope !== 'data' && e.path.startsWith('tests/'))));
    const records = [], ids = new Set();
    for (const entry of entries) {
      const r = JSON.parse(decode(await request('/git/blobs/'+entry.sha,token)));
      if (!r.receipt_id) continue;
      if (!Array.isArray(r.items) || ids.has(r.receipt_id)) throw new Error('明細の形式または重複IDを確認してください。');
      if (entry.path.startsWith('tests/') && r.is_test === false) throw new Error('テストデータの区分に矛盾があります。');
      ids.add(r.receipt_id); records.push(r);
    }
    return {records,entries:tree.tree,commit:head.object.sha,updatedAt:commit.committer?.date||commit.author?.date||null};
  }
  return {apiUrl,accounting,findItems,summarize,groupItems,request,loadGithub};
})();
