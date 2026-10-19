'use strict';
/* Private signed-out guest payment page. Self-contained: no external assets. */

function safeJson(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

const CSS = `
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100dvh;background:#52b6dc;color:#1a1a1a;font:16px/1.55 "Century Gothic","Nunito Sans","Trebuchet MS",system-ui,sans-serif}
h1,h2{font-family:Barlow,Montserrat,"Century Gothic","Trebuchet MS",system-ui,sans-serif;margin:0;color:#005d8f;letter-spacing:.01em}
.wrap{max-width:960px;margin:0 auto;padding:20px 16px 40px}
header{display:flex;align-items:center;gap:12px;color:#fff;padding:8px 0 20px}
.mark{font-weight:900;font-size:1.35rem;letter-spacing:.2em;text-transform:uppercase}
.tag{margin-left:auto;font-size:.85rem;font-weight:700}
.grid{display:grid;gap:16px;grid-template-columns:1fr}
@media(min-width:768px){.grid.two{grid-template-columns:1.15fr .85fr;align-items:start}.wrap{padding:32px 24px 56px}}
.card{background:#fff;border-radius:16px;padding:20px;min-width:0}
.card.blue{background:#005d8f;color:#fff}.card.blue h1,.card.blue h2{color:#fff}
h1{font-size:1.7rem;font-weight:900;line-height:1.2}h2{font-size:1.1rem;font-weight:800;margin-bottom:10px}
p{margin:.5em 0;overflow-wrap:anywhere}
.meta{display:grid;gap:2px;margin:12px 0;font-size:.95rem}
.meta b{color:#005d8f}
ul.items{list-style:none;margin:0;padding:0}
.items li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid #1a1a1a22}
.items li:first-child{border-top:0}.items .n{min-width:0;overflow-wrap:anywhere}.items small{display:block;opacity:.75}
.items .t{white-space:nowrap;font-weight:700}
.total{display:flex;justify-content:space-between;border-top:2px solid #005d8f;margin-top:8px;padding-top:12px;font-weight:900;font-size:1.2rem;color:#005d8f}
.badge{display:inline-block;border:2px solid currentColor;border-radius:999px;padding:2px 12px;font-weight:800;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em}
fieldset{border:0;margin:0 0 12px;padding:0}legend{font-weight:800;color:#005d8f;margin-bottom:6px;padding:0}
.opt{display:flex;gap:10px;align-items:center;border:2px solid #005d8f;border-radius:12px;padding:12px;margin-bottom:8px;cursor:pointer;min-height:48px}
.opt input{accent-color:#005d8f;width:20px;height:20px;margin:0}
.opt:has(input:checked){background:#005d8f;color:#fff}
label.f{display:block;font-weight:700;margin:10px 0 4px}
input[type=email],input[type=tel]{width:100%;font:inherit;padding:12px;border:2px solid #005d8f;border-radius:10px;min-height:48px}
.hint{font-size:.85rem;opacity:.8}
button{font:inherit;font-weight:800;background:#005d8f;color:#fff;border:2px solid #005d8f;border-radius:12px;min-height:48px;padding:0 20px;cursor:pointer;width:100%;margin-top:12px}
button.alt{background:#fff;color:#005d8f}
button[disabled]{opacity:.55;cursor:not-allowed}
:focus-visible{outline:3px solid #1a1a1a;outline-offset:3px}
.notice{border-left:6px solid #005d8f;background:#fff;padding:12px;border-radius:8px;margin-top:12px;color:#1a1a1a}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.skel{height:18px;border-radius:8px;background:#005d8f22;margin:12px 0}
[hidden]{display:none!important}
.foot{color:#fff;font-size:.85rem;margin-top:20px;text-align:center}
@media(prefers-reduced-motion:no-preference){.card{animation:in .25s ease-out}@keyframes in{from{opacity:0;transform:translateY(6px)}}}
`;

const JS = `
(function(){
var CFG=window.__UC_PAY__,API=CFG.apiBase,BASE=CFG.basePath||'',KEY='uc_guest_pay_token:'+BASE;
var $=function(i){return document.getElementById(i)};
var token='';
try{
  var seg=location.pathname.split('/').filter(Boolean);
  if(seg.length>=2&&seg[seg.length-2]==='pay'){token=decodeURIComponent(seg[seg.length-1]);}
  if(token){try{sessionStorage.setItem(KEY,token)}catch(e){}}
  else{try{token=sessionStorage.getItem(KEY)||''}catch(e){}}
  if(location.pathname!==BASE+'/pay'||location.search||location.hash)history.replaceState(null,'',BASE+'/pay');
}catch(e){}
var busy=false,pollTimer=null,pollCount=0,S=null;
// Same explicitly configured Google product adapter, with tokenless context.
// No tracker is installed unless the owner's existing collection opt-in is on.
var a=CFG.analytics,seenEvents={};
if(a&&a.enabled&&a.bootstrapApproved&&/^G-[A-Z0-9]+$/.test(a.measurementId||'')){
  window.dataLayer=window.dataLayer||[];
  window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};
  window.gtag('js',new Date());
  window.gtag('config',a.measurementId,{send_page_view:false,page_location:location.origin+BASE+'/pay',page_referrer:''});
  var tracker=document.createElement('script');tracker.async=true;tracker.referrerPolicy='no-referrer';
  tracker.src='https://www.googletagmanager.com/gtag/js?id='+a.measurementId;document.head.appendChild(tracker);
}
var STATES={
 paid:['Payment received','This order has been paid and verified. Thank you. You can close this page; the buyer will be notified.'],
 pending:['Payment in progress','A payment for this order has started but is not yet confirmed. Do not pay again. We are checking for confirmation.'],
 cancelled:['Order cancelled','This order was cancelled, so no payment is needed. Please contact the buyer if you expected to pay.'],
  expired:['Link expired','This link cannot start a payment. If payment may already have started, do not pay again; ask the buyer to check the original order. Otherwise, ask them to refresh the order and send a new link.'],
 replaced:['Link replaced','The buyer sent a newer payment link for this order. Please use the latest link.'],
 invalid:['Link not valid','We could not open this payment link. Check that you used the complete link, or ask the buyer to send it again.'],
  refresh_required:['Order needs buyer review','The price, stock or order details need review. Please ask the buyer to refresh and explicitly accept a new checkout before sending another link.'],
  review_required:['Payment review needed','The provider reports this attempt did not complete. Do not start another payment. Ask the buyer to have the team reconcile or permanently void the original attempt first.']
};
function post(path,body){
  return fetch(API+path,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store'})
  .then(function(r){return r.json().catch(function(){return null}).then(function(j){if(!r.ok)throw new Error('http');return j})});
}
function money(n,c){try{return new Intl.NumberFormat(undefined,{style:'currency',currency:c||'KES'}).format(n)}catch(e){return (c||'')+' '+n}}
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function say(msg){var n=$('live');n.textContent=msg||'';n.hidden=!msg}
function setBusy(b){busy=b;var f=$('form');f.setAttribute('aria-busy',b?'true':'false');
  Array.prototype.forEach.call(document.querySelectorAll('#form button,#form input'),function(x){x.disabled=b});
  $('pay').textContent=b?'Please wait...':'Pay securely'}
function host(u){try{var x=new URL(u);return x.protocol==='https:'&&!x.username&&!x.password&&!x.port&&['checkout.paystack.com','checkout.stripe.com','paystack.com'].indexOf(x.hostname)>-1?x.href:''}catch(e){return ''}}
function track(s){
  var a=CFG.analytics;
  if(!a||!a.enabled||!/^G-[A-Z0-9]+$/.test(a.measurementId||'')||typeof window.gtag!=='function')return;
  (s.analyticsEvents||[]).forEach(function(event){
    if(['pay_link_opened','begin_checkout','pay_link_paid','purchase'].indexOf(event)<0||seenEvents[event])return;
    var params={send_to:a.measurementId,page_location:location.origin+BASE+'/pay',page_referrer:''};
    if(event==='purchase'||event==='pay_link_paid'){
      if(s.state!=='paid'||s.verified!==true||!/^UC-[1-9][0-9]*$/.test(s.transactionId||''))return;
      params.transaction_id=s.transactionId;params.value=s.total;params.currency='KES';
    }
    seenEvents[event]=true;
    try{window.gtag('event',event,params)}catch(e){}
  });
}
function render(s){
  S=s;var st=s.state;
  $('skel').hidden=true;$('main').hidden=false;
  var m=STATES[st]||STATES.invalid;
  var sum=$('summary');sum.textContent='';
  var ready=st==='ready';
  $('title').textContent=ready?('Pay for '+(s.buyerFirstName||'your friend')+'\\u2019s order'):m[0];
  $('badge').textContent=ready?'Awaiting payment':(st==='paid'&&s.verified===true?'Verified':st.replace('_',' '));
  var msg=$('msg');msg.textContent=ready?'You are paying for an order exactly as shown. It cannot be changed from this page.':m[1];
  if(st==='paid'&&s.verified!==true){msg.textContent='Payment is not yet verified. Please check its status; do not pay again.'}
  if(!s.items||st==='invalid'){$('details').hidden=true}else{
    $('details').hidden=false;
    var meta=$('meta');meta.textContent='';
    [['Buyer',s.buyerFirstName],['Delivery area',s.deliveryArea],['Fulfilment',s.fulfillment],['Reference',s.transactionId]].forEach(function(p){
      if(!p[1])return;var d=el('div');d.appendChild(el('b','',p[0]+': '));d.appendChild(document.createTextNode(String(p[1])));meta.appendChild(d)});
    var ul=$('items');ul.textContent='';
    s.items.forEach(function(i){var li=el('li');var n=el('div','n',i.name+' x '+i.quantity);
       var sub=[i.size,i.variant,i.sku].filter(Boolean).join(' / ');if(sub)n.appendChild(el('small','',sub));
      li.appendChild(n);li.appendChild(el('div','t',money(i.total,s.currency)));ul.appendChild(li)});
    $('totalv').textContent=money(s.total,s.currency);
  }
  var showForm=ready;
  $('form').hidden=!showForm;
  if(showForm)buildMethods(s.methods||{});
   $('refresh').hidden=!(st==='pending'||(st==='paid'&&s.verified!==true));
  $('refresh').disabled=false;
   var resume=host(s.resumeUrl||'');$('resume').hidden=st!=='pending'||!resume;
   $('resume').onclick=function(){if(resume)location.assign(resume)};
   track(s);
}
function buildMethods(m){
  var box=$('methods');if(box.dataset.built)return;box.dataset.built='1';
  var defs=[['paystack','Card or bank (Paystack)'],['mpesa','M-Pesa'],['stripe','International card (Stripe)']];
  var first=true,any=false;
  defs.forEach(function(d){
    if(!m[d[0]])return;any=true;
    var l=el('label','opt');var r=document.createElement('input');r.type='radio';r.name='method';r.value=d[0];if(first){r.checked=true;first=false}
    r.addEventListener('change',fields);l.appendChild(r);l.appendChild(el('span','',d[1]));box.appendChild(l)});
  if(!any){$('form').hidden=true;$('msg').textContent='No payment methods are available right now. Please contact the buyer.'}
  fields();
}
function method(){var r=document.querySelector('input[name=method]:checked');return r?r.value:''}
function fields(){var v=method();$('emailw').hidden=v!=='paystack';$('phonew').hidden=v!=='mpesa';$('err').hidden=true}
function fail(t){var e=$('err');e.textContent=t;e.hidden=false}
function poll(){
  clearTimeout(pollTimer);
  if(pollCount++>20){say('Still waiting for confirmation. You can check again with the button below.');return}
  pollTimer=setTimeout(function(){reconcile(true)},Math.min(3000+pollCount*1000,10000));
}
function reconcile(auto){
  if(!token)return;
  if(!auto){$('refresh').disabled=true;say('Checking payment status...')}
  post('/guest-pay/reconcile',{token:token}).then(function(s){
    if(!s||!s.state)throw 0;render(s);say('');
    if(s.state==='pending'||(s.state==='paid'&&s.verified===false))poll();
     else if(s.state==='paid'&&s.verified===true)track(s);
  }).catch(function(){say('We could not check the payment just now. If you already paid, do not pay again; try checking once more shortly.');$('refresh').disabled=false;$('refresh').hidden=false});
}
function submit(ev){
  ev.preventDefault();
  if(busy||!S||S.state!=='ready')return;
  var v=method();if(!v)return fail('Choose a payment method.');
  var body={token:token,method:v};
  if(v==='paystack'){var em=$('email').value.trim();
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(em)||em.length>254)return fail('Enter a valid email address for your Paystack receipt.');body.email=em}
  if(v==='mpesa'){var ph=$('phone').value.replace(/[\\s-]/g,'');
    if(!/^(?:\\+?254|0)?[17][0-9]{8}$/.test(ph))return fail('Enter a valid Safaricom number, for example 0712 345 678.');body.phone=ph}
  $('err').hidden=true;setBusy(true);
  post('/guest-pay/initialize',body).then(function(r){
    r=r||{};
    var u=host(r.authorizationUrl||r.sessionUrl||'');
    if(u){say('Taking you to the secure payment page...');location.assign(u);return}
    if(r.state==='pending'||r.reference||r.checkoutRequestId){
      say(v==='mpesa'?'Check your phone and enter your M-Pesa PIN to approve the payment.':'Payment started. Checking for confirmation...');
      $('form').hidden=true;render(Object.assign({},S,{state:'pending'}));reconcile(false);return}
    throw 0;
  }).catch(function(){setBusy(false);
     S=Object.assign({},S,{state:'pending'});$('form').hidden=true;
     say('The payment outcome is unknown. Do not pay again. Check the original payment status below.');
    $('refresh').hidden=false;
  });
}
function load(){
  if(!token){$('skel').hidden=true;$('main').hidden=false;$('details').hidden=true;$('form').hidden=true;
    $('title').textContent='Open your payment link';$('badge').textContent='No link';
    $('msg').textContent='This page needs the personal payment link the buyer sent you. Open that link again, or ask the buyer to resend it.';return}
  post('/guest-pay/summary',{token:token}).then(function(s){
     if(!s||!s.state)throw 0;render(s);
    if(s.state==='pending'||(s.state==='paid'&&s.verified===false))poll();
  }).catch(function(){
    $('skel').hidden=true;$('main').hidden=false;$('details').hidden=true;$('form').hidden=true;
    $('title').textContent='We could not load this order';$('badge').textContent='Unavailable';
     $('msg').textContent='We could not check this order. If payment may have started, do not pay again. Try checking its status shortly.';
    $('retry').hidden=false;
  });
}
$('form').addEventListener('submit',submit);
$('refresh').addEventListener('click',function(){reconcile(false)});
$('retry').addEventListener('click',function(){$('retry').hidden=true;$('main').hidden=true;$('skel').hidden=false;load()});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&S&&(S.state==='pending')&&!busy)reconcile(true)});
load();
})();
`;

function renderGuestPayPage(opts) {
  const o = opts || {};
  const a = o.analytics || {};
  const analytics = {
    enabled: a.enabled === true && typeof a.measurementId === 'string' && /^G-[A-Z0-9]+$/.test(a.measurementId),
    measurementId: typeof a.measurementId === 'string' && /^G-[A-Z0-9]+$/.test(a.measurementId) ? a.measurementId : '',
    bootstrapApproved: a.bootstrapApproved === true,
  };
  const apiBase = String(o.apiBase || '').replace(/\/+$/, '');
  const cfg = safeJson({ apiBase, analytics, basePath: String(o.basePath || '') });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow, noarchive">
<meta name="theme-color" content="#52b6dc">
<title>Pay for an order | Ultra Clear</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
<header><span class="mark">Ultra Clear</span><span class="tag">Secure guest payment</span></header>
<main>
<div id="skel" class="card" aria-busy="true" role="status"><span class="sr">Loading order</span><div class="skel" style="width:60%"></div><div class="skel"></div><div class="skel" style="width:80%"></div></div>
<div id="main" hidden>
<div class="grid two">
<section class="card" aria-labelledby="title">
<span id="badge" class="badge"></span>
<h1 id="title"></h1>
<p id="msg"></p>
<p id="live" class="notice" role="status" aria-live="polite" hidden></p>
<button id="refresh" type="button" class="alt" hidden>Check payment status</button>
<button id="resume" type="button" class="alt" hidden>Resume the same hosted payment</button>
<button id="retry" type="button" class="alt" hidden>Try again</button>
<div id="details">
<div id="meta" class="meta"></div>
<h2>Order summary</h2>
<ul id="items" class="items"></ul>
<div class="total"><span>Total</span><span id="totalv"></span></div>
</div>
<div id="summary" hidden></div>
</section>
<form id="form" class="card blue" novalidate hidden>
<h2>Pay now</h2>
<fieldset><legend>Payment method</legend><div id="methods"></div></fieldset>
<div id="emailw" hidden><label class="f" for="email">Your email</label><input id="email" type="email" autocomplete="email" inputmode="email" maxlength="254"><p class="hint">Used only for the payment receipt from Paystack.</p></div>
<div id="phonew" hidden><label class="f" for="phone">M-Pesa phone number</label><input id="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="16" placeholder="0712 345 678"><p class="hint">You will get a prompt on this phone.</p></div>
<p id="err" class="notice" role="alert" hidden></p>
<button id="pay" type="submit" class="alt">Pay securely</button>
<p class="hint">You do not need an account. The buyer's contact details are never shown here.</p>
</form>
</div>
</div>
</main>
<p class="foot">Ultra Clear. Payments are processed by the provider's secure page.</p>
</div>
<noscript><div class="wrap"><div class="card"><p>JavaScript is required to complete this payment.</p></div></div></noscript>
<script>window.__UC_PAY__=${cfg};</script>
<script>${JS}</script>
</body>
</html>`;
}

module.exports = { renderGuestPayPage };
