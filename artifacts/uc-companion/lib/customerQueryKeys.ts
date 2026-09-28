export type CustomerId = number | string | null | undefined;

export const customerQueryKeys = {
  locationRating: (customerId: CustomerId, locationId: string | number | undefined) =>
    ['customer', customerId, 'location-rating', locationId] as const,
  orders: (customerId: CustomerId) =>
    ['customer', customerId, 'orders'] as const,
  order: (customerId: CustomerId, orderId: string | number | undefined) =>
    ['customer', customerId, 'order', orderId] as const,
  rewards: (customerId: CustomerId) =>
    ['customer', customerId, 'rewards'] as const,
  referral: (customerId: CustomerId) =>
    ['customer', customerId, 'referral'] as const,
  profile: (customerId: CustomerId) =>
    ['customer', customerId, 'profile'] as const,
  wishlist: (customerId: CustomerId) =>
    ['customer', customerId, 'wishlist'] as const,
  reviews: (customerId: CustomerId, productId: string | number | undefined) =>
    ['customer', customerId, 'reviews', productId] as const,
  tickets: (customerId: CustomerId) =>
    ['customer', customerId, 'tickets'] as const,
  waterTests: (customerId: CustomerId) =>
    ['customer', customerId, 'water-tests'] as const,
  returnRequest: (customerId: CustomerId, orderId: string | number | undefined) =>
    ['customer', customerId, 'return-request', orderId] as const,
  adminProductMedia: (customerId: CustomerId, productId: string | number | undefined) =>
    ['customer', customerId, 'admin-product-media', productId] as const,
};
