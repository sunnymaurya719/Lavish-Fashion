import axios from 'axios';

const recommendSize = async ({ backendUrl, token, productId, userMetrics, mode = 'manual', bodyFeatures = null }) => {
  const response = await axios.post(
    backendUrl + '/api/fit/recommend-size',
    {
      productId,
      mode,
      userMetrics,
      ...(bodyFeatures ? { bodyFeatures } : {}),
    },
    {
      headers: token ? { token } : {},
    }
  );

  return response.data;
};

const analyzeBodyScan = async ({ backendUrl, token, heightCm, weightKg, imageBase64 = '', landmarks = [] }) => {
  const response = await axios.post(
    backendUrl + '/api/fit/body-scan',
    {
      heightCm,
      ...(weightKg ? { weightKg } : {}),
      ...(imageBase64 ? { imageBase64 } : {}),
      ...(Array.isArray(landmarks) && landmarks.length ? { landmarks } : {}),
    },
    {
      headers: token ? { token } : {},
    }
  );

  return response.data;
};

const getFitInsights = async ({ backendUrl, productId }) => {
  const response = await axios.get(backendUrl + `/api/fit/insights/${productId}`);

  return response.data;
};

const getFitFeedbackHistory = async ({ backendUrl, token }) => {
  const response = await axios.get(backendUrl + '/api/fit/feedback', {
    headers: token ? { token } : {},
  });

  return response.data;
};

const submitFitFeedback = async ({
  backendUrl,
  token,
  productId,
  orderId,
  selectedSize,
  recommendedSize,
  feedback,
  source = 'manual',
  confidence = null,
  modelVersion = '',
}) => {
  const response = await axios.post(
    backendUrl + '/api/fit/feedback',
    {
      productId,
      orderId,
      selectedSize,
      recommendedSize,
      feedback,
      source,
      ...(confidence === null || confidence === undefined ? {} : { confidence }),
      ...(modelVersion ? { modelVersion } : {}),
    },
    {
      headers: token ? { token } : {},
    }
  );

  return response.data;
};

export { analyzeBodyScan, getFitFeedbackHistory, getFitInsights, recommendSize, submitFitFeedback };
