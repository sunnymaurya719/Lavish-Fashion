import { useCallback, useState } from 'react';
import { toast } from 'react-toastify';
import { invalidateAdminQuery } from './useAdminQuery';

/**
 * Wraps a mutation function with optimistic update + rollback + toast.
 *
 * Usage:
 *   const archive = useAdminMutation(
 *     (productId) => axios.post(`${BACKEND_URL}/api/product/archive`, { productId }, { headers: { token } }),
 *     {
 *       successMessage: 'Product archived',
 *       invalidateKeys: [['products']],
 *       optimistic: ({ args, queryClient }) => { ... },
 *       rollback: ({ snapshot }) => { ... },
 *     },
 *   );
 *
 *   await archive.mutate(productId);
 */
const useAdminMutation = (
  mutationFn,
  {
    successMessage,
    errorMessage,
    suppressSuccessToast = false,
    suppressErrorToast = false,
    invalidateKeys = [],
    onSuccess,
    onError,
    onSettled,
  } = {}
) => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = useCallback(
    async (...args) => {
      setIsLoading(true);
      setError(null);
      try {
        const result = await mutationFn(...args);
        invalidateKeys.forEach((key) => invalidateAdminQuery(key));
        if (successMessage && !suppressSuccessToast) toast.success(successMessage);
        onSuccess?.(result, ...args);
        return result;
      } catch (err) {
        setError(err);
        if (!suppressErrorToast) {
          const message =
            errorMessage || err?.response?.data?.message || err?.message || 'Action failed';
          toast.error(message);
        }
        onError?.(err, ...args);
        throw err;
      } finally {
        setIsLoading(false);
        onSettled?.(...args);
      }
    },
    [
      mutationFn,
      invalidateKeys,
      successMessage,
      suppressSuccessToast,
      errorMessage,
      suppressErrorToast,
      onSuccess,
      onError,
      onSettled,
    ]
  );

  const reset = useCallback(() => {
    setError(null);
    setIsLoading(false);
  }, []);

  return { mutate, isLoading, error, reset };
};

export default useAdminMutation;
