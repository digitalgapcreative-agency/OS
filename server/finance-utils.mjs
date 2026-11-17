// Pure cash reporting rules, kept separate from MySQL for unit testing.
export const jakartaToday=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
export const asOfMonth=(month, today=jakartaToday())=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid report month');
  const [year,m]=month.split('-').map(Number);
  const end=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
  return end<today?end:today;
};
export const calculateCashSummary=transactions=>{
  const received=transactions.filter(t=>t.kind==='income').reduce((s,t)=>s+Number(t.amount),0);
  const spent=transactions.filter(t=>t.kind==='expense').reduce((s,t)=>s+Number(t.amount),0);
  return {received,spent,net:received-spent};
};
export const outstanding=(total,payments)=>{
  const due=Number(total)-payments.reduce((s,p)=>s+Number(p),0);
  if(!Number.isSafeInteger(due)) throw new Error('Invalid monetary amount');
  return Math.max(due,0);
};
