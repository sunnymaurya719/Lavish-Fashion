const adminNavigationSections = [
  {
    label: 'Overview',
    items: [
      {
        label: 'Dashboard',
        to: '/dashboard',
        icon: 'dashboard',
        description: 'Revenue, customers, and fulfillment'
      }
    ]
  },
  {
    label: 'Catalog',
    items: [
      {
        label: 'Products',
        to: '/products',
        icon: 'products',
        description: 'Catalog, pricing, and publishing'
      },
      {
        label: 'Inventory',
        to: '/inventory',
        icon: 'inventory',
        description: 'Live stock, thresholds, and status'
      },
      {
        label: 'New Product',
        to: '/products/new',
        icon: 'create',
        description: 'Launch new catalog items'
      }
    ]
  },
  {
    label: 'Commerce',
    items: [
      {
        label: 'Orders',
        to: '/orders',
        icon: 'orders',
        description: 'Track and update fulfillment'
      },
      {
        label: 'Customers',
        to: '/customers',
        icon: 'customers',
        description: 'Profiles, notes, and lifecycle value'
      },
      {
        label: 'Coupons',
        to: '/coupons',
        icon: 'coupons',
        description: 'Launch and control promotions'
      }
    ]
  },
  {
    label: 'Growth',
    items: [
      {
        label: 'Loyalty',
        to: '/loyalty',
        icon: 'loyalty',
        description: 'Rewards, tiers, and referral performance'
      },
      {
        label: 'Reviews',
        to: '/reviews',
        icon: 'reviews',
        description: 'Moderation queue and trust signals'
      },
      {
        label: 'Fit Analytics',
        to: '/fit-analytics',
        icon: 'fit',
        description: 'Rollout health, confidence, and shopper fit outcomes'
      },
      {
        label: 'Marketing',
        to: '/marketing',
        icon: 'marketing',
        description: 'Campaigns, automations, and email activity'
      }
    ]
  }
];

const defaultPageMeta = {
  title: 'Admin Workspace',
  description: 'Server-connected operations workspace for Lavish Fashion.'
};

const resolveAdminPageMeta = (pathname = '') => {
  if (pathname === '/' || pathname.startsWith('/dashboard')) {
    return {
      title: 'Executive Dashboard',
      description: 'Live revenue, fulfillment, customer, and inventory signals from the server.'
    };
  }

  if (pathname === '/products/new' || pathname === '/add') {
    return {
      title: 'Create Product',
      description: 'Add new catalog items with media, sizes, stock, and publishing controls.'
    };
  }

  if (/^\/products\/[^/]+\/edit$/.test(pathname) || /^\/edit\/[^/]+$/.test(pathname)) {
    return {
      title: 'Edit Product',
      description: 'Update catalog details, pricing, inventory, and merchandising data.'
    };
  }

  if (pathname.startsWith('/products') || pathname.startsWith('/list')) {
    return {
      title: 'Product Catalog',
      description: 'Manage the full catalog, product lifecycle states, and storefront readiness.'
    };
  }

  if (pathname.startsWith('/inventory')) {
    return {
      title: 'Inventory Control',
      description: 'Monitor live stock risk, low-stock thresholds, and item availability.'
    };
  }

  if (pathname.startsWith('/orders')) {
    return {
      title: 'Order Operations',
      description: 'Track incoming orders, payment state, and fulfillment progress in one place.'
    };
  }

  if (pathname.startsWith('/customers')) {
    return {
      title: 'Customer Management',
      description: 'Understand customer value, order history, wishlist behavior, and internal account notes.'
    };
  }

  if (pathname.startsWith('/coupons')) {
    return {
      title: 'Coupon Management',
      description: 'Create, schedule, activate, and monitor discount campaigns backed by the server.'
    };
  }

  if (pathname.startsWith('/loyalty')) {
    return {
      title: 'Loyalty Intelligence',
      description: 'Track member value, referral conversion, points flow, and retention momentum.'
    };
  }

  if (pathname.startsWith('/reviews')) {
    return {
      title: 'Review Moderation',
      description: 'Approve, reject, and reply to verified reviews while monitoring trust quality.'
    };
  }

  if (pathname.startsWith('/fit-analytics')) {
    return {
      title: 'Fit Analytics',
      description: 'Track fit rollout readiness, recommendation confidence, and post-delivery shopper outcomes.'
    };
  }

  if (pathname.startsWith('/marketing')) {
    return {
      title: 'Marketing Automation',
      description: 'Manage lifecycle campaigns, broadcast sends, and the latest email delivery activity.'
    };
  }

  return defaultPageMeta;
};

const isNavItemActive = (pathname = '', to = '') => {
  if (to === '/dashboard') {
    return pathname === '/' || pathname.startsWith('/dashboard');
  }

  if (to === '/products') {
    return pathname === '/products' || pathname === '/list' || /^\/products\/[^/]+\/edit$/.test(pathname) || /^\/edit\/[^/]+$/.test(pathname);
  }

  if (to === '/products/new') {
    return pathname === '/products/new' || pathname === '/add';
  }

  if (to === '/inventory') {
    return pathname.startsWith('/inventory');
  }

  if (to === '/orders') {
    return pathname.startsWith('/orders');
  }

  if (to === '/customers') {
    return pathname.startsWith('/customers');
  }

  if (to === '/coupons') {
    return pathname.startsWith('/coupons');
  }

  if (to === '/loyalty') {
    return pathname.startsWith('/loyalty');
  }

  if (to === '/reviews') {
    return pathname.startsWith('/reviews');
  }

  if (to === '/fit-analytics') {
    return pathname.startsWith('/fit-analytics');
  }

  if (to === '/marketing') {
    return pathname.startsWith('/marketing');
  }

  return pathname === to;
};

export { adminNavigationSections, defaultPageMeta, isNavItemActive, resolveAdminPageMeta };
