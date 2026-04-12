import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import axios from 'axios';
import { notify as toast } from '../utils/notify';
import { useNavigate } from 'react-router-dom';

// eslint-disable-next-line react-refresh/only-export-components
export const ShopContext = createContext();

const normalizeUrl = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
const DEFAULT_BACKEND_URL = 'http://localhost:4000';
const FIT_SELECTIONS_STORAGE_KEY = 'lf-fit-selections';
const readStoredFitSelections = () => {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const rawValue = window.sessionStorage.getItem(FIT_SELECTIONS_STORAGE_KEY);
    const parsedValue = rawValue ? JSON.parse(rawValue) : {};
    return parsedValue && typeof parsedValue === 'object' ? parsedValue : {};
  } catch {
    return {};
  }
};
const writeStoredFitSelections = (value) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(FIT_SELECTIONS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore client storage write failures and keep the in-memory state as the source of truth.
  }
};

const ShopContextProvider = (props) => {
  const currency = '\u20B9';
  const delivery_fee = 10;
  const BACKEND_URL = normalizeUrl(import.meta.env.VITE_BACKEND_URL) || DEFAULT_BACKEND_URL;
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [cartItems, setCartItems] = useState({});
  const [products, setProducts] = useState([]);
  const [loadingProductsData, setLoadingProductsData] = useState(false);
  const [loadingWishlist, setLoadingWishlist] = useState(false);
  const [wishlistItems, setWishlistItems] = useState([]);
  const [fitSelections, setFitSelections] = useState(() => readStoredFitSelections());
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [serverBootstrap, setServerBootstrap] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const [lastServerSyncAt, setLastServerSyncAt] = useState('');
  const authExpiryHandledRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    writeStoredFitSelections(fitSelections);
  }, [fitSelections]);

  const clearCartState = useCallback(() => {
    setCartItems({});
    setFitSelections({});
  }, []);

  const clearCartFitSelections = useCallback(() => {
    setFitSelections({});
  }, []);

  const clearSession = useCallback(
    ({ message = '', redirectTo = '/login' } = {}) => {
      localStorage.removeItem('token');
      if (typeof window !== 'undefined') {
        window.google?.accounts?.id?.disableAutoSelect?.();
      }
      setToken(null);
      clearCartState();
      setWishlistItems([]);
      setLoadingWishlist(false);

      if (message) {
        toast.info(message);
      }

      if (redirectTo) {
        navigate(redirectTo);
      }
    },
    [clearCartState, navigate]
  );

  const bootstrapServer = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) {
        setServerStatus('checking');
      }

      try {
        const response = await axios.get(BACKEND_URL + '/api/system/bootstrap');

        if (!response.data.success) {
          throw new Error(response.data.message || 'Unable to reach the server bootstrap endpoint');
        }

        const bootstrap = response.data.bootstrap || null;
        setServerBootstrap(bootstrap);
        setServerStatus('online');
        setLastServerSyncAt(bootstrap?.runtime?.timestamp || new Date().toISOString());
        return bootstrap;
      } catch (error) {
        setServerStatus('offline');

        if (!silent) {
          toast.error(error?.response?.data?.message || 'Unable to connect to the server right now');
        }

        return null;
      }
    },
    [BACKEND_URL]
  );

  const getCartLineItems = useCallback(
    (itemsMap = cartItems) => {
      const lineItems = [];

      for (const itemId in itemsMap) {
        for (const size in itemsMap[itemId]) {
          const quantity = Number(itemsMap[itemId][size] || 0);
          const fitAssistant = fitSelections?.[itemId]?.[size] || null;

          if (quantity > 0) {
            lineItems.push({
              _id: itemId,
              size,
              quantity,
              ...(fitAssistant ? { fitAssistant } : {}),
            });
          }
        }
      }

      return lineItems;
    },
    [cartItems, fitSelections]
  );

  const getCheckoutItems = useCallback(
    ({ isBuyNow = false, buyNowProduct = null } = {}) => {
      if (isBuyNow && buyNowProduct?._id && buyNowProduct?.size) {
        return [
          {
            _id: buyNowProduct._id,
            size: buyNowProduct.size,
            quantity: Number(buyNowProduct.quantity || 1),
            ...(buyNowProduct.fitAssistant ? { fitAssistant: buyNowProduct.fitAssistant } : {}),
          },
        ];
      }

      return getCartLineItems();
    },
    [getCartLineItems]
  );

  const addToCart = async (itemId, size, fitAssistant = null) => {
    if (!size) {
      toast.sizeRequired();
      return false;
    }

    const cartData = structuredClone(cartItems);

    if (cartData[itemId]) {
      if (cartData[itemId][size]) {
        cartData[itemId][size] += 1;
      } else {
        cartData[itemId][size] = 1;
      }
    } else {
      cartData[itemId] = {};
      cartData[itemId][size] = 1;
    }

    setCartItems(cartData);
    setFitSelections((currentSelections) => {
      if (!fitAssistant) {
        if (!currentSelections[itemId]?.[size]) {
          return currentSelections;
        }

        const nextSelections = structuredClone(currentSelections);
        delete nextSelections[itemId][size];

        if (Object.keys(nextSelections[itemId]).length === 0) {
          delete nextSelections[itemId];
        }

        return nextSelections;
      }

      return {
        ...currentSelections,
        [itemId]: {
          ...(currentSelections[itemId] || {}),
          [size]: fitAssistant,
        },
      };
    });

    if (token) {
      try {
        await axios.post(BACKEND_URL + '/api/cart/add', { itemId, size }, { headers: { token } });
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Failed to update cart');
      }
    }
    return true;
  };

  const getCartCount = () =>
    getCartLineItems().reduce((count, item) => count + Number(item.quantity || 0), 0);

  const updateQuantity = async (itemId, size, quantity) => {
    const normalizedQuantity = Math.max(0, Math.min(99, Number(quantity || 0)));
    const cartData = structuredClone(cartItems);

    if (!cartData[itemId]) {
      cartData[itemId] = {};
    }

    cartData[itemId][size] = normalizedQuantity;
    setCartItems(cartData);
    if (normalizedQuantity === 0) {
      setFitSelections((currentSelections) => {
        const nextSelections = structuredClone(currentSelections);

        if (nextSelections[itemId]?.[size]) {
          delete nextSelections[itemId][size];

          if (Object.keys(nextSelections[itemId]).length === 0) {
            delete nextSelections[itemId];
          }
        }

        return nextSelections;
      });
    }

    if (token) {
      try {
        await axios.post(
          BACKEND_URL + '/api/cart/update',
          { itemId, size, quantity: normalizedQuantity },
          { headers: { token } }
        );
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Failed to update cart');
      }
    }
  };

  const getCartAmount = () => {
    let totalAmount = 0;
    const productMap = new Map(products.map((p) => [p._id, p]));

    getCartLineItems().forEach((lineItem) => {
      const product = productMap.get(lineItem._id);

      if (product) {
        totalAmount += Number(product.price || 0) * Number(lineItem.quantity || 0);
      }
    });

    return totalAmount;
  };

  const getProductsData = useCallback(async () => {
    setLoadingProductsData(true);

    try {
      const response = await axios.get(BACKEND_URL + '/api/product/list');

      if (response.data.success) {
        setProducts(response.data.products || []);
        return;
      }

      toast.error(response.data.message || 'Failed to fetch products');
    } catch (error) {
      toast.error(error?.response?.data?.message || 'Failed to fetch products');
    } finally {
      setLoadingProductsData(false);
    }
  }, [BACKEND_URL]);

  const getUserCart = useCallback(
    async (tokenValue) => {
      try {
        const response = await axios.post(BACKEND_URL + '/api/cart/get', {}, { headers: { token: tokenValue } });

        if (response.data.success) {
          setCartItems(response.data.cartData || {});
        }
      } catch (error) {
        const statusCode = Number(error?.response?.status || 0);

        if (statusCode === 401) {
          return;
        }

        toast.error(error?.response?.data?.message || 'Failed to fetch cart data');
      }
    },
    [BACKEND_URL]
  );

  const getUserWishlist = useCallback(
    async (tokenValue) => {
      setLoadingWishlist(true);

      try {
        const response = await axios.get(BACKEND_URL + '/api/user/wishlist', {
          headers: { token: tokenValue },
        });

        if (response.data.success) {
          setWishlistItems(response.data.wishlist || []);
          return;
        }

        toast.error(response.data.message || 'Failed to fetch wishlist');
      } catch (error) {
        const statusCode = Number(error?.response?.status || 0);
        const errorMessage = String(error?.response?.data?.message || '').toLowerCase();

        if (statusCode === 401) {
          return;
        }

        if (statusCode === 404 && errorMessage.includes('route not found')) {
          setWishlistItems([]);
          return;
        }

        toast.error(error?.response?.data?.message || 'Failed to fetch wishlist');
      } finally {
        setLoadingWishlist(false);
      }
    },
    [BACKEND_URL]
  );

  const toggleWishlist = useCallback(async (itemId) => {
    if (!token) {
      toast.info('Please login to save items to your wishlist');
      navigate('/login');
      return false;
    }

    const wasWishlisted = wishlistItems.includes(itemId);

    // Optimistic update — instant UI response before server replies
    if (wasWishlisted) {
      setWishlistItems((prev) => prev.filter((id) => id !== itemId));
      toast.success('Removed from wishlist', { showCloseButton: false });
    } else {
      setWishlistItems((prev) => [...prev, itemId]);
      toast.wishlistAdded();
    }

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/user/wishlist/toggle',
        { itemId },
        { headers: { token } }
      );

      if (!response.data.success) {
        // Revert optimistic update
        setWishlistItems((prev) =>
          wasWishlisted ? [...prev, itemId] : prev.filter((id) => id !== itemId)
        );
        toast.error(response.data.message || 'Failed to update wishlist');
        return false;
      }

      // Sync with server's authoritative state
      setWishlistItems(response.data.wishlist || []);
      return true;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);

      // Revert optimistic update on failure
      setWishlistItems((prev) =>
        wasWishlisted ? [...prev, itemId] : prev.filter((id) => id !== itemId)
      );

      if (statusCode === 401) {
        return false;
      }

      toast.error(error?.response?.data?.message || 'Failed to update wishlist');
      return false;
    }
  }, [token, wishlistItems, BACKEND_URL, navigate]);

  // O(1) Set derived from wishlistItems — rebuilt only when the array changes
  const wishlistSet = useMemo(() => new Set(wishlistItems), [wishlistItems]);
  const isWishlisted = useCallback((itemId) => wishlistSet.has(itemId), [wishlistSet]);
  const getWishlistCount = () => wishlistItems.length;

  useEffect(() => {
    bootstrapServer({ silent: true });
  }, [bootstrapServer]);

  useEffect(() => {
    getProductsData();
  }, [getProductsData]);

  useEffect(() => {
    if (!token && localStorage.getItem('token')) {
      setToken(localStorage.getItem('token'));
    }
  }, [token]);

  useEffect(() => {
    if (!token) {
      authExpiryHandledRef.current = false;
      setCartItems({});
      setWishlistItems([]);
      setLoadingWishlist(false);
      return;
    }

    authExpiryHandledRef.current = false;
    Promise.all([getUserCart(token), getUserWishlist(token)]);
  }, [token, getUserCart, getUserWishlist]);

  useEffect(() => {
    const interceptorId = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const statusCode = Number(error?.response?.status || 0);
        const requestUrl = String(error?.config?.url || '');
        const isUserApiRequest =
          requestUrl.includes('/api/') &&
          !requestUrl.includes('/api/user/login') &&
          !requestUrl.includes('/api/user/register') &&
          !requestUrl.includes('/api/user/google') &&
          !requestUrl.includes('/api/user/admin');

        if (token && statusCode === 401 && isUserApiRequest && !authExpiryHandledRef.current) {
          authExpiryHandledRef.current = true;
          clearSession({ message: 'Your session expired. Please login again.' });
        }

        return Promise.reject(error);
      }
    );

    return () => {
      axios.interceptors.response.eject(interceptorId);
    };
  }, [clearSession, token]);

  const value = useMemo(() => ({
    products,
    currency,
    delivery_fee,
    search,
    setSearch,
    showSearch,
    setShowSearch,
    cartItems,
    addToCart,
    setCartItems,
    getCartCount,
    updateQuantity,
    getCartAmount,
    getCartLineItems,
    getCheckoutItems,
    navigate,
    BACKEND_URL,
    setToken,
    token,
    clearSession,
    clearCartState,
    clearCartFitSelections,
    toast,
    getUserCart,
    loadingProductsData,
    wishlistItems,
    loadingWishlist,
    toggleWishlist,
    isWishlisted,
    getWishlistCount,
    fitSelections,
    serverBootstrap,
    serverStatus,
    lastServerSyncAt,
    bootstrapServer,
  }), [
    products, search, showSearch, cartItems, token, loadingProductsData,
    wishlistItems, loadingWishlist, fitSelections, serverBootstrap, serverStatus,
    lastServerSyncAt, addToCart, getCartCount, updateQuantity, getCartAmount,
    getCartLineItems, getCheckoutItems, clearSession, clearCartState,
    clearCartFitSelections, getUserCart, toggleWishlist, isWishlisted,
    bootstrapServer, navigate, BACKEND_URL, currency, delivery_fee
  ]);

  return <ShopContext.Provider value={value}>{props.children}</ShopContext.Provider>;
};

export default ShopContextProvider;
