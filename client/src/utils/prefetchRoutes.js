const routeModules = {
  '/': () => import('../pages/Home'),
  '/collection': () => import('../pages/Collection'),
  '/about': () => import('../pages/About'),
  '/contact': () => import('../pages/Contact'),
  '/product': () => import('../pages/Product'),
  '/cart': () => import('../pages/Cart'),
  '/wishlist': () => import('../pages/Wishlist'),
  '/login': () => import('../pages/Login'),
  '/profile': () => import('../pages/Profile'),
  '/rewards': () => import('../pages/Rewards'),
  '/place-order': () => import('../pages/PlaceOrder'),
  '/orders': () => import('../pages/Orders'),
};

const prefetched = new Set();

export const prefetchRoute = (path) => {
  const basePath = '/' + (path.split('/')[1] || '');
  const key = basePath === '/' ? path : basePath;

  if (prefetched.has(key)) return;

  const loader = routeModules[key];
  if (loader) {
    prefetched.add(key);
    loader();
  }
};
