import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzeBodyScan, recommendSize } from '../../services/fitApi';
import {
  captureVideoFrame,
  getCameraErrorMessage,
  stopMediaStream,
  supportsCameraCapture,
} from '../../utils/bodyScan';

const fitOptions = [
  { value: 'slim', label: 'Slim' },
  { value: 'regular', label: 'Regular' },
  { value: 'relaxed', label: 'Relaxed' },
];

const methodOptions = [
  {
    value: 'manual',
    label: 'Manual input',
    description: 'Use height, weight, and fit preference for a fast recommendation.',
  },
  {
    value: 'camera',
    label: 'Camera scan',
    description: 'Capture one guided frame and blend scan features into the recommendation.',
  },
];

const manualHighlights = [
  'We use your inputs and this product\'s garment measurements to estimate the best fit.',
  'Manual mode is the safest fallback when your camera is blocked or lighting is weak.',
  'For the best result, use current measurements rather than aspirational sizing.',
];

const cameraInstructions = [
  'Stand 1.5 to 2 meters away from the camera.',
  'Keep your shoulders and hips visible in good lighting.',
  'Wear fitted clothing if possible and keep the frame portrait-oriented.',
];

const formatConfidence = (value) => `${Math.round(Number(value || 0) * 100)}%`;
const formatSourceLabel = (value) => {
  if (value === 'image_heuristic') {
    return 'Guided image scan';
  }

  if (value === 'landmarks') {
    return 'Pose landmarks';
  }

  if (value === 'xgboost_regressor') {
    return 'ML scoring';
  }

  return 'Fit analysis';
};
const formatFitBiasLabel = (value) => {
  if (value === 'runs_small') {
    return 'Runs small';
  }

  if (value === 'runs_large') {
    return 'Runs large';
  }

  return 'True to size';
};
const formatRecommendationLabel = (result) =>
  result?.meta?.lowConfidence && result?.recommendation?.range ? 'Best-fit suggestion' : 'Recommended size';

const buildFitAssistantSelection = ({ result, selectedMethod, appliedSize }) => {
  if (!result?.recommendation?.size || !appliedSize) {
    return null;
  }

  return {
    recommendedSize: result.recommendation.size,
    confidence: Number(result.recommendation.confidence || 0),
    source: selectedMethod === 'camera' ? 'hybrid' : 'manual',
    modelVersion: String(result.meta?.modelVersion || '').trim(),
  };
};

const FitAssistantModal = ({
  isOpen,
  onClose,
  product,
  backendUrl,
  token,
  toast,
  onApplySize,
  cameraEnabled = false,
}) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [selectedMethod, setSelectedMethod] = useState('manual');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [preferredFit, setPreferredFit] = useState('regular');
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [capturedImage, setCapturedImage] = useState('');
  const [bodyFeatures, setBodyFeatures] = useState(null);
  const [bodyScanMeta, setBodyScanMeta] = useState(null);
  const [cameraError, setCameraError] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const stopCamera = useCallback(() => {
    stopMediaStream(streamRef.current);
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setIsCameraActive(false);
    setIsCameraReady(false);
  }, []);

  const resetCameraState = useCallback(() => {
    stopCamera();
    setCapturedImage('');
    setBodyFeatures(null);
    setBodyScanMeta(null);
    setCameraError('');
  }, [stopCamera]);

  const resetResultState = useCallback(() => {
    setResult(null);
    setErrorMessage('');
  }, []);

  const validateMetrics = () => {
    const parsedHeight = Number(heightCm);
    const parsedWeight = Number(weightKg);

    if (!Number.isFinite(parsedHeight) || parsedHeight < 50 || parsedHeight > 260) {
      return 'Enter a valid height between 50 cm and 260 cm.';
    }

    if (!Number.isFinite(parsedWeight) || parsedWeight < 20 || parsedWeight > 350) {
      return 'Enter a valid weight between 20 kg and 350 kg.';
    }

    return '';
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return undefined;
    }

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
      stopCamera();
    };
  }, [isOpen, onClose, stopCamera]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedMethod('manual');
    setPreferredFit('regular');
    resetResultState();
    resetCameraState();
  }, [isOpen, product?._id, resetCameraState, resetResultState]);

  useEffect(() => {
    if (cameraEnabled || selectedMethod !== 'camera') {
      return;
    }

    setSelectedMethod('manual');
    resetCameraState();
  }, [cameraEnabled, resetCameraState, selectedMethod]);

  const confidenceWidth = useMemo(
    () => `${Math.max(8, Math.min(100, Math.round(Number(result?.recommendation?.confidence || 0) * 100)))}%`,
    [result?.recommendation?.confidence]
  );

  const scanQualityWidth = useMemo(
    () => `${Math.max(8, Math.min(100, Math.round(Number(bodyFeatures?.scanQuality || 0) * 100)))}%`,
    [bodyFeatures?.scanQuality]
  );

  const [isCameraReady, setIsCameraReady] = useState(false);

  const startCamera = async () => {
    if (isStartingCamera || isSubmitting) {
      return;
    }

    if (!cameraEnabled) {
      setCameraError('Camera scan is not enabled on this store right now.');
      return;
    }

    if (!supportsCameraCapture()) {
      setCameraError('This browser does not support camera capture. Please use manual measurements instead.');
      return;
    }

    resetResultState();
    setCameraError('');
    setIsCameraReady(false);
    setIsStartingCamera(true);

    try {
      stopCamera();

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });

      streamRef.current = stream;
      setCapturedImage('');
      setBodyFeatures(null);
      setBodyScanMeta(null);
      setIsCameraActive(true);
    } catch (error) {
      setCameraError(getCameraErrorMessage(error));
    } finally {
      setIsStartingCamera(false);
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;

    if (!isCameraActive || !video || !stream) {
      return;
    }

    video.srcObject = stream;

    const onLoadedMetadata = () => setIsCameraReady(true);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.play().catch(() => undefined);

    return () => {
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
    };
  }, [isCameraActive]);

  const captureScan = () => {
    if (!videoRef.current || !isCameraReady) {
      setCameraError('Camera preview is still loading. Wait a moment and try again.');
      return;
    }

    try {
      const nextCapturedImage = captureVideoFrame(videoRef.current);
      setCapturedImage(nextCapturedImage);
      setCameraError('');
      stopCamera();
    } catch (error) {
      setCameraError(error?.message || 'Unable to capture the scan image.');
    }
  };

  const handleRetake = () => {
    setCapturedImage('');
    setBodyFeatures(null);
    setBodyScanMeta(null);
    setResult(null);
    setErrorMessage('');
    startCamera();
  };

  const handleManualSubmit = async (event) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const validationMessage = validateMetrics();
    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setResult(null);

    try {
      const response = await recommendSize({
        backendUrl,
        token,
        productId: product._id,
        mode: 'manual',
        userMetrics: {
          heightCm: Number(heightCm),
          weightKg: Number(weightKg),
          preferredFit,
        },
      });

      if (!response.success) {
        setErrorMessage(response.message || 'Unable to recommend a size right now.');
        return;
      }

      setResult(response);
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Unable to recommend a size right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCameraAnalyze = async () => {
    if (isSubmitting) {
      return;
    }

    const validationMessage = validateMetrics();
    if (validationMessage) {
      setErrorMessage(validationMessage);
      return;
    }

    if (!capturedImage) {
      setCameraError('Capture a scan image before analyzing your fit.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setResult(null);

    try {
      const scanResponse = await analyzeBodyScan({
        backendUrl,
        token,
        heightCm: Number(heightCm),
        weightKg: Number(weightKg),
        imageBase64: capturedImage,
      });

      if (!scanResponse.success) {
        setErrorMessage(scanResponse.message || 'Unable to analyze the body scan right now.');
        return;
      }

      setBodyFeatures(scanResponse.bodyFeatures || null);
      setBodyScanMeta(scanResponse.meta || null);

      const recommendationResponse = await recommendSize({
        backendUrl,
        token,
        productId: product._id,
        mode: 'camera',
        userMetrics: {
          heightCm: Number(heightCm),
          weightKg: Number(weightKg),
          preferredFit,
        },
        bodyFeatures: scanResponse.bodyFeatures || null,
      });

      if (!recommendationResponse.success) {
        setErrorMessage(recommendationResponse.message || 'Unable to recommend a size right now.');
        return;
      }

      setResult(recommendationResponse);
    } catch (error) {
      setErrorMessage(error?.response?.data?.message || 'Unable to analyze the body scan right now.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen || !product) {
    return null;
  }

  return (
    <div className='fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4'>
      <button
        type='button'
        className='absolute inset-0'
        onClick={onClose}
        aria-label='Close fit assistant'
      ></button>

      <div
        className='relative w-full max-w-5xl overflow-hidden rounded-t-[28px] border border-white/50 bg-[#f9f6f1] shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:rounded-[32px]'
        role='dialog'
        aria-modal='true'
        aria-labelledby='fit-assistant-title'
      >
        <div className='grid gap-0 lg:grid-cols-[0.9fr_1.1fr]'>
          <div className='bg-[#efe8dd] px-6 py-7 sm:px-8'>
            <div className='flex items-start justify-between gap-4'>
              <div>
                <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Fit Assistant</p>
                <h2 id='fit-assistant-title' className='mt-2 text-3xl font-semibold tracking-[-0.02em] text-slate-900'>
                  Find your best size
                </h2>
              </div>
              <button
                type='button'
                onClick={onClose}
                className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-slate-600'
                aria-label='Close fit assistant'
              >
                x
              </button>
            </div>

            <p className='mt-4 text-sm leading-6 text-slate-600'>
              {selectedMethod === 'camera'
                ? 'Camera mode captures a single guided frame, extracts fit features, and blends them with your measurements. Raw images are not stored.'
                : 'Manual mode uses your height, weight, fit preference, and this product\'s garment data to recommend the best size.'}
            </p>

            <div className='mt-6 rounded-[28px] bg-white/80 p-5'>
              <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Product</p>
              <p className='mt-2 text-xl font-semibold text-slate-900'>{product.name}</p>
              <p className='mt-1 text-sm text-slate-600'>
                {product.category} / {product.subCategory}
              </p>

              <div className='mt-5 space-y-3 text-sm text-slate-600'>
                {(selectedMethod === 'camera' ? cameraInstructions : manualHighlights).map((item) => (
                  <div key={item} className='flex items-start gap-3'>
                    <span className='mt-1 h-2 w-2 rounded-full bg-slate-500'></span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {selectedMethod === 'camera' ? (
              <div className='mt-5 rounded-[28px] border border-slate-200 bg-white/85 p-5'>
                <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Privacy</p>
                <p className='mt-3 text-sm leading-6 text-slate-600'>
                  We only keep extracted body features like shoulder and torso ratios. Raw photos are processed for
                  scan analysis and are not stored in your account.
                </p>
              </div>
            ) : null}
          </div>

          <div className='px-6 py-7 sm:px-8'>
            <div className='grid gap-3 sm:grid-cols-2'>
              {methodOptions.map((option) => {
                const isDisabled = option.value === 'camera' && !cameraEnabled;

                return (
                  <button
                    key={option.value}
                    type='button'
                    disabled={isDisabled || isSubmitting}
                    onClick={() => {
                      if (option.value !== selectedMethod) {
                        setSelectedMethod(option.value);
                        resetResultState();
                        setCameraError('');
                        if (option.value !== 'camera') {
                          resetCameraState();
                        }
                      }
                    }}
                    className={`rounded-[24px] border px-4 py-4 text-left transition ${
                      selectedMethod === option.value
                        ? 'border-slate-900 bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.16)]'
                        : isDisabled
                          ? 'border-slate-200 bg-slate-100 text-slate-400'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <p className='text-sm font-semibold uppercase tracking-[0.12em]'>{option.label}</p>
                    <p
                      className={`mt-2 text-sm leading-6 ${
                        selectedMethod === option.value ? 'text-slate-200' : 'text-slate-500'
                      }`}
                    >
                      {isDisabled ? 'Camera scan needs the store camera feature and ML service enabled.' : option.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className='mt-5 grid gap-4 sm:grid-cols-2'>
              <div>
                <label className='mb-2 block text-sm font-medium text-slate-700'>Height (cm)</label>
                <input
                  type='number'
                  min='50'
                  max='260'
                  step='1'
                  value={heightCm}
                  onChange={(event) => {
                    setHeightCm(event.target.value);
                    resetResultState();
                  }}
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                  placeholder='175'
                  required
                />
              </div>

              <div>
                <label className='mb-2 block text-sm font-medium text-slate-700'>Weight (kg)</label>
                <input
                  type='number'
                  min='20'
                  max='350'
                  step='0.5'
                  value={weightKg}
                  onChange={(event) => {
                    setWeightKg(event.target.value);
                    resetResultState();
                  }}
                  className='w-full rounded-2xl border border-slate-300 bg-white px-4 py-3'
                  placeholder='72'
                  required
                />
              </div>
            </div>

            <div className='mt-5'>
              <label className='mb-2 block text-sm font-medium text-slate-700'>Preferred fit</label>
              <div className='flex flex-wrap gap-2.5'>
                {fitOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      setPreferredFit(option.value);
                      resetResultState();
                    }}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      preferredFit === option.value
                        ? 'bg-slate-950 text-white shadow-[0_12px_24px_rgba(15,23,42,0.18)]'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            {selectedMethod === 'manual' ? (
              <form onSubmit={handleManualSubmit} className='mt-5 space-y-4'>
                <button
                  type='submit'
                  disabled={isSubmitting}
                  className='w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-white disabled:opacity-60'
                >
                  {isSubmitting ? 'Analyzing your fit...' : 'Find My Size'}
                </button>
              </form>
            ) : (
              <div className='mt-5 space-y-4'>
                <div className='overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950'>
                  <div className='aspect-[4/5] bg-gradient-to-b from-slate-900 to-slate-800'>
                    {capturedImage ? (
                      <img src={capturedImage} alt='Captured body scan preview' className='h-full w-full object-cover' />
                    ) : isCameraActive ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        webkit-playsinline="true"
                        className='h-full w-full object-cover'
                      />
                    ) : (
                      <div className='flex h-full flex-col items-center justify-center px-6 text-center text-slate-200'>
                        <p className='text-[11px] uppercase tracking-[0.24em] text-slate-400'>Camera preview</p>
                        <p className='mt-3 max-w-xs text-sm leading-6 text-slate-300'>
                          Start the camera, center your upper body, and capture a single portrait frame.
                        </p>
                      </div>
                    )}
                  </div>

                  <div className='border-t border-white/10 px-4 py-4 text-sm text-slate-300'>
                    {capturedImage
                      ? 'Scan captured. Review the frame or analyze it now.'
                      : isCameraActive
                        ? 'Hold still and keep shoulders and hips visible before capturing.'
                        : 'Portrait framing works best for the current scan pipeline.'}
                  </div>
                </div>

                {bodyFeatures ? (
                  <div className='rounded-[24px] border border-slate-200 bg-white p-4'>
                    <div className='flex items-center justify-between gap-3 text-sm text-slate-600'>
                      <span>Scan quality</span>
                      <span className='font-medium text-slate-900'>{formatConfidence(bodyFeatures.scanQuality)}</span>
                    </div>
                    <div className='mt-2 h-3 overflow-hidden rounded-full bg-slate-100'>
                      <div
                        className='h-full rounded-full bg-gradient-to-r from-sky-400 via-sky-500 to-blue-500'
                        style={{ width: scanQualityWidth }}
                      ></div>
                    </div>
                    <p className='mt-3 text-xs uppercase tracking-[0.16em] text-slate-500'>
                      {formatSourceLabel(bodyScanMeta?.source)} used for body features
                    </p>
                  </div>
                ) : null}

                <div className='flex flex-wrap gap-3'>
                  {!isCameraActive && !capturedImage ? (
                    <button
                      type='button'
                      onClick={startCamera}
                      disabled={isStartingCamera || isSubmitting}
                      className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:opacity-60'
                    >
                      {isStartingCamera ? 'Starting camera...' : 'Start Camera'}
                    </button>
                  ) : null}

                  {isCameraActive ? (
                    <>
                      <button
                        type='button'
                        onClick={captureScan}
                        disabled={isSubmitting || !isCameraReady}
                        className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:opacity-60'
                      >
                        {isCameraReady ? 'Capture Scan' : 'Waiting for camera...'}
                      </button>
                      <button
                        type='button'
                        onClick={stopCamera}
                        disabled={isSubmitting}
                        className='rounded-full border border-slate-300 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-slate-700 disabled:opacity-60'
                      >
                        Stop Camera
                      </button>
                    </>
                  ) : null}

                  {capturedImage ? (
                    <>
                      <button
                        type='button'
                        onClick={handleCameraAnalyze}
                        disabled={isSubmitting}
                        className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:opacity-60'
                      >
                        {isSubmitting ? 'Analyzing your fit...' : 'Analyze Fit'}
                      </button>
                      <button
                        type='button'
                        onClick={handleRetake}
                        disabled={isSubmitting}
                        className='rounded-full border border-slate-300 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-slate-700 disabled:opacity-60'
                      >
                        Retake Scan
                      </button>
                    </>
                  ) : null}
                </div>

                {cameraError ? (
                  <div className='rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>
                    {cameraError}
                  </div>
                ) : null}
              </div>
            )}

            {errorMessage ? (
              <div className='mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700'>
                {errorMessage}
              </div>
            ) : null}

            <div aria-live='polite' className='mt-4 min-h-6 text-sm text-slate-500'>
              {isSubmitting ? 'Analyzing your fit...' : ''}
            </div>

            {result ? (
              <div className='mt-2 rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'>
                <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
                  <div>
                    <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>
                      {formatRecommendationLabel(result)}
                    </p>
                    <p className='mt-2 text-4xl font-semibold tracking-[-0.03em] text-slate-950'>
                      {result.recommendation.size}
                    </p>
                    <p className='mt-3 text-sm leading-6 text-slate-600'>{result.recommendation.reason}</p>
                    <p className='mt-3 text-xs uppercase tracking-[0.16em] text-slate-500'>
                      {result.source === 'ml'
                        ? `${formatSourceLabel(result.meta?.predictionSource)} recommendation`
                        : 'Rule engine fallback recommendation'}
                    </p>
                  </div>

                  <button
                    type='button'
                    onClick={() => {
                      onApplySize({
                        size: result.recommendation.size,
                        fitAssistant: buildFitAssistantSelection({
                          result,
                          selectedMethod,
                          appliedSize: result.recommendation.size,
                        }),
                      });
                      toast.success(`Recommended size ${result.recommendation.size} selected`, { showCloseButton: false });
                      onClose();
                    }}
                    className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.14em] text-white'
                  >
                    Use {result.recommendation.size}
                  </button>
                </div>

                <div className='mt-5'>
                  <div className='mb-2 flex items-center justify-between text-sm text-slate-600'>
                    <span>Confidence</span>
                    <span className='font-medium text-slate-900'>{formatConfidence(result.recommendation.confidence)}</span>
                  </div>
                  <div className='h-3 overflow-hidden rounded-full bg-slate-100'>
                    <div
                      className='h-full rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500'
                      style={{ width: confidenceWidth }}
                    ></div>
                  </div>
                  {result.recommendation.range ? (
                    <p className='mt-2 text-xs uppercase tracking-[0.16em] text-slate-500'>
                      Lower confidence: best range {result.recommendation.range}
                    </p>
                  ) : null}
                </div>

                {result.meta?.lowConfidence ? (
                  <div className='mt-4 rounded-[24px] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900'>
                    <p className='font-medium uppercase tracking-[0.16em] text-[11px]'>Confidence note</p>
                    <p className='mt-2 leading-6'>
                      {result.meta?.confidenceGuidance ||
                        'This result is below the store confidence threshold, so treat it as a best-fit range rather than a single exact answer.'}
                    </p>
                  </div>
                ) : null}

                {result.insights?.fitBias || result.insights?.crowdSignal ? (
                  <div className='mt-5 rounded-[24px] bg-slate-50 px-4 py-4'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='text-[11px] uppercase tracking-[0.22em] text-slate-500'>Fit notes</span>
                      {result.insights?.fitBias ? (
                        <span className='rounded-full bg-white px-3 py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-700 ring-1 ring-slate-200'>
                          {formatFitBiasLabel(result.insights.fitBias)}
                        </span>
                      ) : null}
                    </div>

                    {result.insights?.crowdSignal ? (
                      <p className='mt-3 text-sm leading-6 text-slate-600'>{result.insights.crowdSignal}</p>
                    ) : (
                      <p className='mt-3 text-sm leading-6 text-slate-600'>
                        Trend signal is based on this product&apos;s measured fit profile and verified fit feedback.
                      </p>
                    )}
                  </div>
                ) : null}

                {Array.isArray(result.alternatives) && result.alternatives.length > 0 ? (
                  <div className='mt-5'>
                    <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Alternatives</p>
                    <div className='mt-3 flex flex-wrap gap-2.5'>
                      {result.alternatives.map((alternative) => (
                        <button
                          key={alternative.size}
                          type='button'
                          onClick={() => {
                            onApplySize({
                              size: alternative.size,
                              fitAssistant: buildFitAssistantSelection({
                                result,
                                selectedMethod,
                                appliedSize: alternative.size,
                              }),
                            });
                            toast.info(`Alternative size ${alternative.size} selected`, { showCloseButton: false });
                            onClose();
                          }}
                          className='rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-700 transition hover:border-slate-400 hover:bg-slate-50'
                        >
                          {alternative.size} | {formatConfidence(alternative.confidence)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default FitAssistantModal;
