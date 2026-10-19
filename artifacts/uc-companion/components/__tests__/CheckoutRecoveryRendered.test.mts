import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { __testRender, useState } from '../../__mocks__/react.ts';
import { _reset } from '../../__mocks__/@react-native-async-storage/async-storage.ts';
import { readCheckoutRecovery } from '../../hooks/checkoutRecovery.ts';

// File-backed ESM fixtures also work through Node/tsx's Windows CJS bridge.
const fixtureRoot = mkdtempSync(join(tmpdir(), 'uc-checkout-rendered-'));
let fixtureId = 0;
const url = (code: string) => {
  const file = join(fixtureRoot, `${fixtureId++}.mjs`);
  writeFileSync(file, code);
  return pathToFileURL(file).href;
};
after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
const stateUrl = url(`
  export let user={id:41,firstName:'Amina',lastName:'Otieno',phone:'+254712345678',address:'Test building, Nairobi'};
  export let items=[{id:1,name:'Hydra Flux',price:3499,quantity:1}];
  export let mode='review', calls=[], clears=0, cancellations=0;
  export function setup(next){mode=next;calls=[];clears=0;cancellations=0;items=[{id:1,name:'Hydra Flux',price:3499,quantity:1}];}
  export function newCart(){items=[{id:1,name:'Hydra Flux',price:3499,quantity:1}];}
  export function setMode(next){mode=next;}
  export function useAuth(){return {user};}
  export function useCart(){return {items,totalPrice:3499,cartHydrated:true,clearCart(){clears++;items=[];}};}
  export class ApiError extends Error {constructor(message,status,body={}){super(message);this.status=status;this.body=body;}}
  export function useApi(){return {
    async getPaymentsConfig(){return {methods:{cod:true,paystack:false,mpesa:false,stripe:false}};},
    async quoteCheckout(input){return {...input,total:3499,lines:[{productId:1,quantity:1,name:'Hydra Flux',subtotal:3499}]};},
    async createOrder(input){calls.push(input);if(mode==='invalid')throw new ApiError('Prices changed',422,{fields:{quotedTotal:'Refresh total'}});return {id:71,reconciliationRequired:mode==='review'};},
    async getCheckoutRecovery(){return {resolution:mode==='resolved'?'completed':mode==='invalid'?'editable':'unresolved',orderId:71};},
    async cancelCheckout(){if(mode==='review')throw new ApiError('Still needs review',409);cancellations++;return {cancelled:true};}
  };}
`);
const state = await import(stateUrl);
const empty = url('export default function Component(){return null;}');
const mocks: Record<string,string> = {
  '@/context/AuthContext':stateUrl, '@/context/CartContext':stateUrl, '@/hooks/useApi':stateUrl,
  '@/hooks/useColors':url('export function useColors(){return {primary:"#0054A6",text:"#000",mutedForeground:"#666"};}'),
  'expo-router':url('export function useRouter(){return {replace(){},push(){},back(){}};} export function useLocalSearchParams(){return {};}'),
  'react-native-safe-area-context':url('export function useSafeAreaInsets(){return {top:0,bottom:0};}'),
  '@tanstack/react-query':url('export function useQueryClient(){return {async invalidateQueries(){}};}'),
  'expo-haptics':url('export const ImpactFeedbackStyle={}; export function impactAsync(){}'),
  'expo-web-browser':url('export function openAuthSessionAsync(){} export function openBrowserAsync(){}'),
  'expo-clipboard':url('export async function setStringAsync(){}'),
  '@/lib/analytics':url('export function trackEvent(){}'),
  '@/components/AlisonBubble':empty, '@/components/ContactCompletion':empty,
  '@/components/PaymentMethodPicker':empty,
  '@/components/CountryPicker':url('export function CountryPicker(){return null;}'),
};
const loader = registerHooks({resolve(specifier,context,next){return mocks[specifier]
  ? {url:mocks[specifier],shortCircuit:true} : next(specifier,context);}});
const Checkout = createRequire(import.meta.url)('../../app/checkout.tsx').default;
loader.deregister();
const roots: any[]=[];
afterEach(()=>{for(const root of roots.splice(0))root.dispose();});
function render() {
  let redraw!: (value: (n:number)=>number)=>void;
  const root=__testRender(()=>{const [,set]=useState(0);redraw=set;return {props:{value:Checkout()}};},{});
  roots.push(root);
  return {root,redraw:()=>{redraw(n=>n+1);root.flush();}};
}
async function settle(root:any){for(let i=0;i<8;i++){await new Promise(r=>setImmediate(r));root.flush();}}
function all(tree:any):any[]{return !tree||typeof tree!=='object'?[]:[tree,...[tree.props?.children].flat(Infinity).flatMap(all)];}
function text(tree:any):string{return typeof tree==='string'?tree:!tree||typeof tree!=='object'?'':[tree.props?.children].flat(Infinity).map(text).join(' ');}
function button(root:any,label:string){const result=all(root.value).find(n=>n.props?.onPress &&
  (label === 'Confirm' ? n.props.onPress.name === 'handleConfirm' : text(n).toLowerCase().includes(label.toLowerCase())));
  assert.ok(result,`button ${label}`);return result;}
async function start(root:any){
  await settle(root);
  await button(root,'Collection').props.onPress(); await settle(root);
  const confirm=button(root,'Confirm');
  assert.equal(!!confirm.props.disabled,false);
  await confirm.props.onPress(); await settle(root);
}

test('rendered review survives reload, stays blocked while unresolved, then server completion permits a new checkout',async()=>{
  _reset();state.setup('review');
  let screen=render();await start(screen.root);
  assert.equal(state.calls.length,1);
  assert.ok((await readCheckoutRecovery(41))?.reviewOrderId);
  screen.root.dispose();screen=render();await settle(screen.root);
  assert.equal(!!button(screen.root,'Confirm').props.disabled,true);
  await button(screen.root,'Check saved checkout').props.onPress();await settle(screen.root);
  assert.equal(state.calls.length,1);
  assert.ok(await readCheckoutRecovery(41));
  state.setMode('resolved');
  await button(screen.root,'Check saved checkout').props.onPress();await settle(screen.root);
  assert.equal(await readCheckoutRecovery(41),null);
  assert.equal(state.clears,1);
  state.newCart();screen.redraw();await settle(screen.root);
  await button(screen.root,'Confirm').props.onPress();await settle(screen.root);
  assert.equal(state.calls.length,2);
  assert.notEqual(state.calls[0].idempotencyKey,state.calls[1].idempotencyKey);
});

test('rendered preflight rejection can be safely retired after reload, edited and submitted with a new identity',async()=>{
  _reset();state.setup('invalid');
  let screen=render();await start(screen.root);
  const original=(await readCheckoutRecovery(41))!.identity.idempotencyKey;
  screen.root.dispose();screen=render();await settle(screen.root);
  await button(screen.root,'Check saved checkout').props.onPress();await settle(screen.root);
  assert.equal(state.cancellations,1);
  const address=all(screen.root.value).find(n=>n.type==='TextInput'&&n.props.value==='Test building, Nairobi');
  assert.ok(address);assert.notEqual(address.props.editable,false);
  address.props.onChangeText('Corrected building, Nairobi');await settle(screen.root);
  state.setMode('resolved');
  await button(screen.root,'Confirm').props.onPress();await settle(screen.root);
  assert.equal(state.calls.length,2);
  assert.notEqual(state.calls[1].idempotencyKey,original);
  assert.equal(state.calls[1].shippingAddress.address1,'Corrected building, Nairobi');
});

test('rendered oversized contact is rejected before freezing and remains editable',async()=>{
  _reset();state.setup('resolved');
  const screen=render();await settle(screen.root);
  await button(screen.root,'Collection').props.onPress();await settle(screen.root);
  const address=all(screen.root.value).find(n=>n.type==='TextInput'&&n.props.value==='Test building, Nairobi');
  address.props.onChangeText('x'.repeat(501));await settle(screen.root);
  await button(screen.root,'Confirm').props.onPress();await settle(screen.root);
  assert.equal(state.calls.length,0);
  assert.equal(await readCheckoutRecovery(41),null);
  assert.match(text(screen.root.value),/500 characters/);
  assert.notEqual(all(screen.root.value).find(n=>n.type==='TextInput'&&n.props.value==='x'.repeat(501)).props.editable,false);
});
