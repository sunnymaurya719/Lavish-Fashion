import { createContext, useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

// eslint-disable-next-line react-refresh/only-export-components
export const ShopContext = createContext();

const normalizeUrl = (value) => String(value || '').trim().replace(/^['"]|['"]$/g, '').replace(/\/$/, '');
const DEFAULT_BACKEND_URL = 'http://localhost:4000';

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
  const [token, setToken] = useState(localStorage.getItem('token') || null);
  const [serverBootstrap, setServerBootstrap] = useState(null);
  const [serverStatus, setServerStatus] = useState('checking');
  const [lastServerSyncAt, setLastServerSyncAt] = useState('');
  const authExpiryHandledRef = useRef(false);
  const navigate = useNavigate();

  const clearSession = useCallback(
    ({ message = '', redirectTo = '/login' } = {}) => {
      localStorage.removeItem('token');
      setToken(null);
      setCartItems({});
      setWishlistItems([]);
      setLoadingWishlist(false);

      if (message) {
        toast.info(message);
      }

      if (redirectTo) {
        navigate(redirectTo);
      }
    },
    [navigate]
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

          if (quantity > 0) {
            lineItems.push({
              _id: itemId,
              size,
              quantity,
            });
          }
        }
      }

      return lineItems;
    },
    [cartItems]
  );

  const getCheckoutItems = useCallback(
    ({ isBuyNow = false, buyNowProduct = null } = {}) => {
      if (isBuyNow && buyNowProduct?._id && buyNowProduct?.size) {
        return [
          {
            _id: buyNowProduct._id,
            size: buyNowProduct.size,
            quantity: Number(buyNowProduct.quantity || 1),
          },
        ];
      }

      return getCartLineItems();
    },
    [getCartLineItems]
  );

  const addToCart = async (itemId, size) => {
    if (!size) {
      toast.error('Please select a size');
      return;
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

    if (token) {
      try {
        await axios.post(BACKEND_URL + '/api/cart/add', { itemId, size }, { headers: { token } });
      } catch (error) {
        toast.error(error?.response?.data?.message || 'Failed to update cart');
      }
    }
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

    getCartLineItems().forEach((lineItem) => {
      const product = products.find((item) => item._id === lineItem._id);

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

  const toggleWishlist = async (itemId) => {
    if (!token) {
      toast.info('Please login to save items to your wishlist');
      navigate('/login');
      return false;
    }

    try {
      const response = await axios.post(
        BACKEND_URL + '/api/user/wishlist/toggle',
        { itemId },
        { headers: { token } }
      );

      if (!response.data.success) {
        toast.error(response.data.message || 'Failed to update wishlist');
        return false;
      }

      setWishlistItems(response.data.wishlist || []);
      toast.success(response.data.message || 'Wishlist updated');
      return true;
    } catch (error) {
      const statusCode = Number(error?.response?.status || 0);

      if (statusCode === 401) {
        return false;
      }

      toast.error(error?.response?.data?.message || 'Failed to update wishlist');
      return false;
    }
  };

  const isWishlisted = (itemId) => wishlistItems.includes(itemId);
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
    getUserCart(token);
    getUserWishlist(token);
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

  const value = {
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
    toast,
    getUserCart,
    loadingProductsData,
    wishlistItems,
    loadingWishlist,
    toggleWishlist,
    isWishlisted,
    getWishlistCount,
    serverBootstrap,
    serverStatus,
    lastServerSyncAt,
    bootstrapServer,
  };

  return <ShopContext.Provider value={value}>{props.children}</ShopContext.Provider>;
};

export default ShopContextProvider;
