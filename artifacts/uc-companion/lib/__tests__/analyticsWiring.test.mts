import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('customer commerce events are wired to successful, deduplicated flow boundaries', () => {
  const product = source('app/product/[id].tsx');
  assert.match(product, /viewedProducts\.current\.has\(product\.id\)/);
  assert.match(product, /viewedProducts\.current\.add\(product\.id\)/);
  assert.match(product, /trackEvent\('product_viewed', \{ productId: product\.id \}\)/);

  const cart = source('context/CartContext.tsx');
  assert.match(cart, /trackEvent\('cart_item_added', \{ productId: product\.id, quantity: product\.quantity \}\)/);
  assert.match(cart, /Every real customer-facing add path funnels through this method/);

  const checkout = source('app/checkout.tsx');
  assert.match(checkout, /!cartHydrated \|\| items\.length === 0 \|\| checkoutStarted\.current/);
  assert.match(checkout, /trackEvent\('checkout_started'/);
  assert.ok(checkout.indexOf('const order = await api.createOrder') < checkout.indexOf("trackEvent('order_submitted'"));
  assert.match(checkout, /paymentMethod: method,\s*itemCount: items\.reduce/);
});

test('review, support, and Alison events include only successful outcomes and safe dimensions', () => {
  const review = source('app/review/new.tsx');
  assert.ok(review.indexOf('await api.submitReview') < review.indexOf("trackEvent('review_submitted'"));
  assert.match(review, /photoCount: uploaded\.filter\(item => item\.type === 'photo'\)\.length/);
  assert.match(review, /videoCount: uploaded\.filter\(item => item\.type === 'video'\)\.length/);

  const ticket = source('app/ticket/new.tsx');
  assert.ok(ticket.indexOf('const ticket = await api.createTicket') < ticket.indexOf("trackEvent('support_ticket_submitted'"));
  assert.match(ticket, /photoCount: uploaded\.filter\(item => item\.type === 'photo'\)\.length/);
  assert.match(ticket, /videoCount: uploaded\.filter\(item => item\.type === 'video'\)\.length/);

  const chat = source('app/ai-chat.tsx');
  assert.equal((chat.match(/trackEvent\('alison_message_sent'\)/g) ?? []).length, 2);
  assert.equal((chat.match(/trackEvent\('alison_reply_received'\)/g) ?? []).length, 2);
  assert.match(chat, /const replyRequest = api\.waterAiChat\([\s\S]*?trackEvent\('alison_message_sent'\)[\s\S]*?await replyRequest/);
  assert.match(chat, /const \{ reply, suggestions \} = await replyRequest;\s*trackEvent\('alison_reply_received'\)/);
});