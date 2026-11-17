export type User = {id:string;full_name:string;email:string;role:'admin'|'manager'|'member'|'finance'|'client'};
export type Item = Record<string, any>;
export const today = () => new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Jakarta'});
export const currentMonth = () => today().slice(0,7);
export const rupiah = (n:any) => 'Rp '+Number(n||0).toLocaleString('id-ID',{maximumFractionDigits:0});
export const compact = (n:any) => {const value=Number(n||0);return Math.abs(value)>=1_000_000?'Rp '+(value/1_000_000).toLocaleString('en-US',{maximumFractionDigits:2})+'M':rupiah(value);};
export async function call<T=any>(url:string, options:RequestInit={}) : Promise<T>{
  const isForm=options.body instanceof FormData;
  const headers:Record<string,string> = {'X-DGAP-Request':'1', ...(isForm?{}:{'Content-Type':'application/json'}),...options.headers as Record<string,string>};
  const response=await fetch(url,{credentials:'same-origin',...options,headers});
  let json:any;
  try{json=await response.json();}catch{throw new Error(`Unexpected server response (${response.status}). Is the API running?`);}
  if(!response.ok) throw new Error(json.error||`Request failed (${response.status})`);
  return json as T;
}
export const get = <T=any>(url:string)=>call<T>(url);
export const post = <T=any>(url:string, body:any)=>call<T>(url,{method:'POST',body:JSON.stringify(body)});
export const patch = <T=any>(url:string, body:any)=>call<T>(url,{method:'PATCH',body:JSON.stringify(body)});
export const put = <T=any>(url:string, body:any)=>call<T>(url,{method:'PUT',body:JSON.stringify(body)});
