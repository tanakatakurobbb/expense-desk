'use strict';
const connectButton=document.getElementById('connect');
const disconnectButton=document.getElementById('disconnect');
const repositoryInput=document.getElementById('connection-repository');
const tokenInput=document.getElementById('connection-token');
const result=document.getElementById('connection-result');
connectButton.onclick=async()=>{
  result.classList.remove('error');
  const token=tokenInput.value.trim();
  const repository=repositoryInput.value.trim();
  if(!token){result.classList.add('error');result.textContent='トークンを入力してください。';return;}
  connectButton.disabled=true;disconnectButton.disabled=true;tokenInput.disabled=true;repositoryInput.disabled=true;
  result.textContent='接続を確認中…';
  try{
    const head=await ReceiptData.request('/git/ref/heads/main',token,repository);
    const commit=await ReceiptData.request('/git/commits/'+head.object.sha,token,repository);
    ReceiptSession.connect(token,repository,new Date().toISOString(),commit.committer?.date||commit.author?.date||null);
    tokenInput.value='';result.textContent='接続成功。左のメニューから読込・編集、または集計画面を開いてください。';
  }catch(error){result.classList.add('error');ReceiptSession.clear();ReceiptSession.patch({connection:'接続失敗',error:error.message});result.textContent='接続失敗。'+error.message;}
  finally{connectButton.disabled=false;disconnectButton.disabled=false;tokenInput.disabled=false;repositoryInput.disabled=false;}
};
disconnectButton.onclick=()=>{result.classList.remove('error');ReceiptSession.clear();tokenInput.value='';result.textContent='接続を解除しました。';};

ReceiptSession.getRepository().then(repository=>{if(!repositoryInput.value)repositoryInput.value=repository;});
