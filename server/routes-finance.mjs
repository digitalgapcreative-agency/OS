import {q,withinTransaction} from './db.mjs';
import {id,amount,nonnegative,dateString,requireField,shortText,enumValue,HttpError,audit} from './helpers.mjs';
import {asOfMonth,jakartaToday} from './finance-utils.mjs';
const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const monthValue = input => {const v=String(input||new Date().toISOString().slice(0,7));if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new HttpError(400,'Invalid month YYYY-MM');return v;};
const money=n=>Number(n||0);
export function registerFinanceRoutes(app,{financeOnly}){
  const pre=financeOnly;
  app.get('/api/finance/accounts',pre,wrap(async(_req,res)=>{
    const items=await q(`SELECT a.*,a.opening_balance
      +COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='income' AND t.account_id=a.id AND t.posted_date<=?),0)
      -COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='expense' AND t.account_id=a.id AND t.posted_date<=?),0)
      -COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='transfer' AND t.account_id=a.id AND t.posted_date<=?),0)
      +COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='transfer' AND t.destination_account_id=a.id),0) balance
      FROM finance_accounts a WHERE a.active=1 ORDER BY a.created_at`);
    res.json({items});
  }));
  app.post('/api/finance/accounts',pre,wrap(async(req,res)=>{
    const newId=id();await q('INSERT INTO finance_accounts(id,name,kind,opening_balance) VALUES (?,?,?,?)',[newId,requireField(req.body.name,'Account',100),enumValue(req.body.kind||'bank',['bank','cash','savings']),nonnegative(req.body.opening_balance||0)]);
    await audit(req.user.id,'finance.account_created','finance_account',newId);res.status(201).json({id:newId});
  }));
  app.get('/api/finance/categories',pre,wrap(async(_req,res)=>res.json({items:await q('SELECT * FROM finance_categories ORDER BY kind,name')})));
  app.post('/api/finance/categories',pre,wrap(async(req,res)=>{
    const newId=id();await q('INSERT INTO finance_categories(id,name,kind) VALUES (?,?,?)',[newId,requireField(req.body.name,'Category',100),enumValue(req.body.kind,['income','expense'])]);
    res.status(201).json({id:newId});
  }));
  app.get('/api/finance/transactions',pre,wrap(async(req,res)=>{
    const month=monthValue(req.query.month);
    const rows=await q(`SELECT t.*,a.name account_name,d.name destination_name,c.name category_name,p.title project_title
      FROM finance_transactions t JOIN finance_accounts a ON a.id=t.account_id
      LEFT JOIN finance_accounts d ON d.id=t.destination_account_id
      LEFT JOIN finance_categories c ON c.id=t.category_id
      LEFT JOIN projects p ON p.id=t.project_id
      WHERE t.posted_date BETWEEN ? AND ? ORDER BY t.posted_date DESC,t.created_at DESC LIMIT 500`,[`${month}-01`,`${month}-01`]);
    res.json({items:rows});
  }));
  app.post('/api/finance/transactions',pre,wrap(async(req,res)=>{
    const x=req.body,kind=enumValue(x.kind,['income','expense','transfer']);
    const total=amount(x.amount),accountId=requireField(x.account_id,'Account',36);
    const date=dateString(x.posted_date),description=requireField(x.description,'Description',255);
    if(date>jakartaToday()) throw new HttpError(400,'Future payments belong in accounts payable/receivable, not posted cash movements');
    const destination=x.destination_account_id||null;
    const invoiceId=x.invoice_id||null,billId=x.bill_id||null;
    if(kind==='transfer' && (!destination||destination===accountId)) throw new HttpError(400,'Choose a different destination account');
    if(kind!=='transfer' && destination) throw new HttpError(400,'Destination account only allowed for transfers');
    if(kind!=='income'&&invoiceId) throw new HttpError(400,'An invoice payment is income');
    if(kind!=='expense'&&billId) throw new HttpError(400,'A bill payment is an expense');
    if(kind==='transfer'&&(invoiceId||billId||x.category_id||x.project_id)) throw new HttpError(400,'Transfer cannot have invoice, bill, category, or project attribution');
    const newId=id(),idem=requireField(x.idempotency_key,'Idempotency key',100);
    const posted=await withinTransaction(async c=>{
      const [duplicate]=await c.execute('SELECT id FROM finance_transactions WHERE idempotency_key=?',[idem]);
      if(duplicate.length) return {id:duplicate[0].id,replayed:true};
      const [accountRows]=await c.execute('SELECT id FROM finance_accounts WHERE id=? AND active=1',[accountId]);if(!accountRows.length) throw new HttpError(400,'Account not found');
      if(destination){const [destRows]=await c.execute('SELECT id FROM finance_accounts WHERE id=? AND active=1',[destination]);if(!destRows.length) throw new HttpError(400,'Destination account not found');}
      let projectId=x.project_id||null;
      if(invoiceId){
        const [[invoice]]=await c.execute('SELECT * FROM invoices WHERE id=? FOR UPDATE',[invoiceId]);if(!invoice||invoice.status!=='issued') throw new HttpError(404,'Issued invoice not found');
        const [[paid]]=await c.execute('SELECT COALESCE(SUM(amount),0) total FROM finance_transactions WHERE invoice_id=?',[invoiceId]);
        if(total>money(invoice.amount)-money(paid.total)) throw new HttpError(409,'Payment exceeds remaining invoice balance');
        if(projectId && projectId!==invoice.project_id) throw new HttpError(400,'Payment project differs from invoice project');
        projectId=invoice.project_id;
      }
      if(billId){
        const [[bill]]=await c.execute('SELECT * FROM bills WHERE id=? FOR UPDATE',[billId]);if(!bill||bill.status!=='open') throw new HttpError(404,'Open bill not found');
        const [[paid]]=await c.execute('SELECT COALESCE(SUM(amount),0) total FROM finance_transactions WHERE bill_id=?',[billId]);
        if(total>money(bill.amount)-money(paid.total)) throw new HttpError(409,'Payment exceeds remaining bill balance');
        if(projectId && projectId!==bill.project_id) throw new HttpError(400,'Payment project differs from bill project');
        projectId=bill.project_id;
      }
      if(projectId){const [p]=await c.execute('SELECT id FROM projects WHERE id=?',[projectId]);if(!p.length) throw new HttpError(400,'Invalid project');}
      if(x.category_id){const [cats]=await c.execute('SELECT id FROM finance_categories WHERE id=? AND kind=?',[x.category_id,kind]);if(!cats.length) throw new HttpError(400,'Category type does not match movement');}
      await c.execute('INSERT INTO finance_transactions(id,posted_date,kind,account_id,destination_account_id,category_id,amount,description,idempotency_key,project_id,invoice_id,bill_id,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[
        newId,date,kind,accountId,destination,x.category_id||null,total,description,idem,projectId,invoiceId,billId,req.user.id]);
      await c.execute('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata) VALUES (?,?,?,?,?,?)',[id(),req.user.id,'finance.transaction_posted','finance_transaction',newId,JSON.stringify({kind,amount:total})]);
      return {id:newId,replayed:false};
    });
    res.status(posted.replayed?200:201).json(posted);
  }));
  app.get('/api/finance/invoices',pre,wrap(async(_req,res)=>{
    const rows=await q(`SELECT i.*,c.name client_name,p.title project_title,COALESCE(SUM(t.amount),0) paid,(i.amount-COALESCE(SUM(t.amount),0)) outstanding
      FROM invoices i JOIN clients c ON c.id=i.client_id LEFT JOIN projects p ON p.id=i.project_id
      LEFT JOIN finance_transactions t ON t.invoice_id=i.id GROUP BY i.id ORDER BY i.due_date ASC`);
    res.json({items:rows});
  }));
  app.post('/api/finance/invoices',pre,wrap(async(req,res)=>{
    const x=req.body,newId=id();const clientId=requireField(x.client_id,'Client',36);
    if(x.project_id){const [p]=await q('SELECT id FROM projects WHERE id=? AND client_id=?',[x.project_id,clientId]);if(!p) throw new HttpError(400,'Project does not belong to client');}
    await q('INSERT INTO invoices(id,client_id,project_id,invoice_number,amount,issue_date,due_date) VALUES(?,?,?,?,?,?,?)',[
      newId,clientId,x.project_id||null,requireField(x.invoice_number,'Invoice number',64),amount(x.amount),dateString(x.issue_date),dateString(x.due_date)]);
    await audit(req.user.id,'finance.invoice_created','invoice',newId);res.status(201).json({id:newId});
  }));
  app.get('/api/finance/bills',pre,wrap(async(_req,res)=>{
    const rows=await q(`SELECT b.*,c.name category_name,p.title project_title,COALESCE(SUM(t.amount),0) paid,(b.amount-COALESCE(SUM(t.amount),0)) outstanding
      FROM bills b LEFT JOIN finance_categories c ON c.id=b.category_id LEFT JOIN projects p ON p.id=b.project_id
      LEFT JOIN finance_transactions t ON t.bill_id=b.id GROUP BY b.id ORDER BY b.due_date ASC`);
    res.json({items:rows});
  }));
  app.post('/api/finance/bills',pre,wrap(async(req,res)=>{
    const x=req.body,newId=id();
    await q('INSERT INTO bills(id,supplier,category_id,project_id,amount,due_date) VALUES (?,?,?,?,?,?)',[
      newId,requireField(x.supplier,'Supplier'),x.category_id||null,x.project_id||null,amount(x.amount),dateString(x.due_date)]);
    await audit(req.user.id,'finance.bill_created','bill',newId);res.status(201).json({id:newId});
  }));
  app.get('/api/finance/budgets',pre,wrap(async(req,res)=>{
    const month=monthValue(req.query.month);
    const rows=await q(`SELECT c.id category_id,c.name,COALESCE(b.limit_amount,0) budget,
      COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.category_id=c.id AND t.kind='expense' AND t.posted_date BETWEEN ? AND ?),0) actual
      FROM finance_categories c LEFT JOIN budgets b ON b.category_id=c.id AND b.month=? WHERE c.kind='expense' ORDER BY c.name`,[`${month}-01`,`${month}-01`,month]);
    res.json({items:rows});
  }));
  app.put('/api/finance/budgets',pre,wrap(async(req,res)=>{
    const month=monthValue(req.body.month),catId=requireField(req.body.category_id,'Category',36);
    const [c]=await q("SELECT id FROM finance_categories WHERE id=? AND kind='expense'",[catId]);if(!c) throw new HttpError(400,'Expense category not found');
    const budget=nonnegative(req.body.limit_amount);
    await q('INSERT INTO budgets(id,month,category_id,limit_amount) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE limit_amount=VALUES(limit_amount)',[id(),month,catId,budget]);
    await audit(req.user.id,'finance.budget_set','budget',catId,{month,budget});res.json({ok:true});
  }));
  app.get('/api/finance/summary',pre,wrap(async(req,res)=>{
    const month=monthValue(req.query.month);
    const asOf=asOfMonth(month);
    const [cash,accounts,receivables,payables,categories,trend,projects]=await Promise.all([
      q("SELECT kind,COALESCE(SUM(amount),0) total FROM finance_transactions WHERE posted_date BETWEEN ? AND ? AND kind IN ('income','expense') GROUP BY kind",[`${month}-01`,asOf]),
      q(`SELECT a.id,a.name,a.kind,a.opening_balance
       +COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='income' AND t.account_id=a.id AND t.posted_date<=?),0)
       -COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='expense' AND t.account_id=a.id AND t.posted_date<=?),0)
       -COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='transfer' AND t.account_id=a.id AND t.posted_date<=?),0)
       +COALESCE((SELECT SUM(t.amount) FROM finance_transactions t WHERE t.kind='transfer' AND t.destination_account_id=a.id AND t.posted_date<=?),0) balance
       FROM finance_accounts a WHERE a.active=1`,[asOf,asOf,asOf,asOf]),
      q("SELECT COALESCE(SUM(i.amount-COALESCE(p.paid,0)),0) total FROM invoices i LEFT JOIN (SELECT invoice_id,SUM(amount) paid FROM finance_transactions WHERE invoice_id IS NOT NULL AND posted_date<=? GROUP BY invoice_id) p ON p.invoice_id=i.id WHERE i.status='issued' AND i.issue_date<=?",[asOf,asOf]),
      q("SELECT COALESCE(SUM(b.amount-COALESCE(p.paid,0)),0) total FROM bills b LEFT JOIN (SELECT bill_id,SUM(amount) paid FROM finance_transactions WHERE bill_id IS NOT NULL AND posted_date<=? GROUP BY bill_id) p ON p.bill_id=b.id WHERE b.status='open' AND DATE(b.created_at)<=?",[asOf,asOf]),
      q("SELECT COALESCE(c.name,'Uncategorised') name, SUM(t.amount) amount FROM finance_transactions t LEFT JOIN finance_categories c ON c.id=t.category_id WHERE t.kind='expense' AND t.posted_date BETWEEN ? AND ? GROUP BY c.name ORDER BY amount DESC",[`${month}-01`,asOf]),
      q("SELECT DATE_FORMAT(posted_date,'%Y-%m') month,kind,SUM(amount) total FROM finance_transactions WHERE kind IN ('income','expense') AND posted_date >= DATE_SUB(STR_TO_DATE(CONCAT(?,'-01'),'%Y-%m-%d'),INTERVAL 5 MONTH) AND posted_date <= ? GROUP BY month,kind ORDER BY month",[month,asOf]),
      q("SELECT p.id,p.title,COALESCE(SUM(CASE WHEN t.kind='income' THEN t.amount ELSE 0 END),0) cash_in,COALESCE(SUM(CASE WHEN t.kind='expense' THEN t.amount ELSE 0 END),0) cash_out FROM projects p LEFT JOIN finance_transactions t ON t.project_id=p.id GROUP BY p.id ORDER BY p.created_at DESC LIMIT 15")
    ]);
    const received=money(cash.find(x=>x.kind==='income')?.total),spent=money(cash.find(x=>x.kind==='expense')?.total);
    res.json({month,asOf,received,spent,net:received-spent,cashBalance:accounts.reduce((s,x)=>s+money(x.balance),0),toReceive:money(receivables[0].total),toPay:money(payables[0].total),accounts,categories,trend,projects});
  }));
}
