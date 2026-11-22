'use strict';
window.ReceiptEditorModel = {
  items(records, mode, selectedId, matches) {
    return records.flatMap(receipt => {
      if (mode === 'single' && receipt.receipt_id !== selectedId) return [];
      return receipt.items.flatMap((item,index) => matches(receipt,item) ? [{r:receipt,i:item,index}] : []);
    });
  },
  changed(records, baseline) {
    return records.filter(receipt => baseline.has(receipt.receipt_id) &&
      JSON.stringify(receipt) !== baseline.get(receipt.receipt_id).json);
  },
  pending(records, baseline) {
    return records.some(receipt => !baseline.has(receipt.receipt_id) ||
      JSON.stringify(receipt) !== baseline.get(receipt.receipt_id).json);
  }
};
