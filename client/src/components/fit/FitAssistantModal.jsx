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

const manualStepGuide = [
  'Add your height and weight.',
  'Choose how you like the garment to fit.',
  'Review the recommendation and apply the size you want.',
];

const cameraStepGuide = [
  'Capture one clear portrait scan.',
  'Add your height, weight, and preferred fit directly below the scan.',
  'Analyze the scan and apply the recommended size.',
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

const getStepPanelStyles = ({ isCurrent, isComplete }) => {
  if (isCurrent) {
    return {
      container: 'border-slate-900 bg-white shadow-[0_16px_36px_rgba(15,23,42,0.08)]',
      badge: 'bg-slate-950 text-white',
      description: 'text-slate-600',
    };
  }

  if (isComplete) {
    return {
      container: 'border-emerald-200 bg-emerald-50/70',
      badge: 'bg-emerald-900 text-white',
      description: 'text-emerald-900/80',
    };
  }

  return {
    container: 'border-slate-200 bg-white',
    badge: 'bg-slate-100 text-slate-600',
    description: 'text-slate-500',
  };
};

const ProgressStep = ({ number, title, description, status, isComplete, isCurrent }) => {
  const styles = getStepPanelStyles({ isCurrent, isComplete });

  return (
    <div className={`rounded-[24px] border px-4 py-4 transition ${styles.container}`}>
      <div className='flex items-start gap-3'>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold uppercase tracking-[0.16em] ${styles.badge}`}
        >
          {number}
        </span>

        <div className='min-w-0'>
          <div className='flex flex-wrap items-center gap-2'>
            <p className='text-sm font-semibold text-slate-900'>{title}</p>
            <span className='rounded-full bg-black/[0.05] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-current'>
              {status}
            </span>
          </div>

          <p className={`mt-1 text-xs leading-5 ${styles.description}`}>{description}</p>
        </div>
      </div>
    </div>
  );
};

const parseMetricValue = (value) => {
  const normalizedValue = String(value ?? '').trim();

  if (!normalizedValue) {
    return {
      empty: true,
      value: null,
    };
  }

  const parsedValue = Number(normalizedValue);

  return {
    empty: false,
    value: Number.isFinite(parsedValue) ? parsedValue : null,
  };
};

const getMetricsValidation = ({ heightCm, weightKg }) => {
  const parsedHeight = parseMetricValue(heightCm);
  const parsedWeight = parseMetricValue(weightKg);

  if (parsedHeight.empty) {
    return {
      isValid: false,
      field: 'height',
      message: 'Enter your height in cm before analyzing your fit.',
      parsedHeight: null,
      parsedWeight: null,
    };
  }

  if (parsedHeight.value === null || parsedHeight.value < 50 || parsedHeight.value > 260) {
    return {
      isValid: false,
      field: 'height',
      message: 'Enter a valid height between 50 cm and 260 cm.',
      parsedHeight: null,
      parsedWeight: null,
    };
  }

  if (parsedWeight.empty) {
    return {
      isValid: false,
      field: 'weight',
      message: 'Enter your weight in kg before analyzing your fit.',
      parsedHeight: parsedHeight.value,
      parsedWeight: null,
    };
  }

  if (parsedWeight.value === null || parsedWeight.value < 20 || parsedWeight.value > 350) {
    return {
      isValid: false,
      field: 'weight',
      message: 'Enter a valid weight between 20 kg and 350 kg.',
      parsedHeight: parsedHeight.value,
      parsedWeight: null,
    };
  }

  return {
    isValid: true,
    field: '',
    message: '',
    parsedHeight: parsedHeight.value,
    parsedWeight: parsedWeight.value,
  };
};

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
  const heightInputRef = useRef(null);
  const weightInputRef = useRef(null);
  const detailsSectionRef = useRef(null);
  const resultSectionRef = useRef(null);
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
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isStartingCamera, setIsStartingCamera] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shouldNudgeToDetails, setShouldNudgeToDetails] = useState(false);

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
    setShouldNudgeToDetails(false);
  }, [stopCamera]);

  const resetResultState = useCallback(() => {
    setResult(null);
    setErrorMessage('');
  }, []);

  const metricsValidation = useMemo(() => getMetricsValidation({ heightCm, weightKg }), [heightCm, weightKg]);

  const isCameraMode = selectedMethod === 'camera';
  const hasCapturedScan = Boolean(capturedImage);
  const hasRecommendation = Boolean(result);
  const availableMethodOptions = useMemo(
    () => methodOptions.filter((option) => option.value !== 'camera' || cameraEnabled),
    [cameraEnabled]
  );
  const selectedFitLabel = useMemo(
    () => fitOptions.find((option) => option.value === preferredFit)?.label || 'Regular',
    [preferredFit]
  );

  const progressSteps = useMemo(() => {
    if (isCameraMode) {
      return [
        {
          id: 'scan',
          number: '01',
          title: 'Capture scan',
          description: 'Take one clear portrait frame.',
          status: hasCapturedScan ? 'Done' : 'Now',
          isComplete: hasCapturedScan,
          isCurrent: !hasCapturedScan && !hasRecommendation,
        },
        {
          id: 'details',
          number: '02',
          title: 'Add details',
          description: 'Height, weight, and fit preference.',
          status: metricsValidation.isValid ? 'Done' : hasCapturedScan && !hasRecommendation ? 'Now' : 'Next',
          isComplete: metricsValidation.isValid,
          isCurrent: hasCapturedScan && !metricsValidation.isValid && !hasRecommendation,
        },
        {
          id: 'result',
          number: '03',
          title: 'Analyze fit',
          description: 'Review and apply the recommendation.',
          status: hasRecommendation ? 'Done' : hasCapturedScan && metricsValidation.isValid ? 'Now' : 'Next',
          isComplete: hasRecommendation,
          isCurrent: hasCapturedScan && metricsValidation.isValid && !hasRecommendation,
        },
      ];
    }

    return [
      {
        id: 'details',
        number: '01',
        title: 'Add details',
        description: 'Height, weight, and fit preference.',
        status: metricsValidation.isValid ? 'Done' : 'Now',
        isComplete: metricsValidation.isValid,
        isCurrent: !metricsValidation.isValid && !hasRecommendation,
      },
      {
        id: 'result',
        number: '02',
        title: 'Get size',
        description: 'Review and apply the recommendation.',
        status: hasRecommendation ? 'Done' : metricsValidation.isValid ? 'Now' : 'Next',
        isComplete: hasRecommendation,
        isCurrent: metricsValidation.isValid && !hasRecommendation,
      },
    ];
  }, [hasCapturedScan, hasRecommendation, isCameraMode, metricsValidation.isValid]);

  const guideContent = useMemo(() => {
    if (result?.recommendation?.size) {
      return {
        eyebrow: 'Recommendation ready',
        title: `${result.recommendation.size} looks like the best match`,
        description: 'Review the reasoning below, then apply the size when you are ready.',
      };
    }

    if (isCameraMode) {
      if (!hasCapturedScan) {
        return {
          eyebrow: 'Step 1 of 3',
          title: isCameraActive ? 'Capture one clear frame' : 'Start with a quick scan',
          description: isCameraActive
            ? 'Hold still with your shoulders and hips inside the frame, then capture the scan.'
            : 'One portrait scan helps the assistant estimate fit more precisely. You can still switch to manual input anytime.',
        };
      }

      if (!metricsValidation.isValid) {
        return {
          eyebrow: 'Step 2 of 3',
          title: 'Your scan is ready. Add your details next.',
          description: 'Height, weight, and fit preference now sit directly below the scan so the next action is easy to spot on mobile.',
        };
      }

      return {
        eyebrow: 'Step 3 of 3',
        title: 'Everything is ready to analyze',
        description: 'Run the fit analysis to compare your scan and measurements against this garment.',
      };
    }

    if (!metricsValidation.isValid) {
      return {
        eyebrow: 'Step 1 of 2',
        title: 'Tell us a little about your build',
        description: 'Add your height, weight, and fit preference to get a recommendation.',
      };
    }

    return {
      eyebrow: 'Step 2 of 2',
      title: 'Get your size recommendation',
      description: 'Your details are ready. Run the fit check and review the best size for this product.',
    };
  }, [hasCapturedScan, isCameraActive, isCameraMode, metricsValidation.isValid, result]);

  const readinessItems = useMemo(() => {
    const detailsStatus = metricsValidation.isValid
      ? `${metricsValidation.parsedHeight} cm / ${metricsValidation.parsedWeight} kg`
      : metricsValidation.field === 'weight'
        ? 'Need weight'
        : 'Need height';

    if (isCameraMode) {
      return [
        { label: 'Scan', value: hasCapturedScan ? 'Ready' : isCameraActive ? 'Live' : 'Needed' },
        { label: 'Details', value: detailsStatus },
        { label: 'Fit', value: selectedFitLabel },
      ];
    }

    return [
      { label: 'Details', value: detailsStatus },
      { label: 'Fit', value: selectedFitLabel },
    ];
  }, [
    hasCapturedScan,
    isCameraActive,
    isCameraMode,
    metricsValidation.field,
    metricsValidation.isValid,
    metricsValidation.parsedHeight,
    metricsValidation.parsedWeight,
    selectedFitLabel,
  ]);

  const heightInputClasses = `w-full rounded-2xl border px-4 py-3 transition ${
    !metricsValidation.isValid && metricsValidation.field === 'height'
      ? 'border-amber-300 bg-amber-50/60'
      : 'border-slate-300 bg-white'
  }`;
  const weightInputClasses = `w-full rounded-2xl border px-4 py-3 transition ${
    !metricsValidation.isValid && metricsValidation.field === 'weight'
      ? 'border-amber-300 bg-amber-50/60'
      : 'border-slate-300 bg-white'
  }`;

  const focusMetricField = useCallback((field) => {
    const targetInput = field === 'weight' ? weightInputRef.current : heightInputRef.current;

    if (!targetInput) {
      return;
    }

    targetInput.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    targetInput.focus({ preventScroll: true });
  }, []);

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

  useEffect(() => {
    if (!shouldNudgeToDetails || selectedMethod !== 'camera') {
      return;
    }

    setShouldNudgeToDetails(false);

    if (!metricsValidation.isValid) {
      detailsSectionRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
      focusMetricField(metricsValidation.field);
    }
  }, [focusMetricField, metricsValidation.field, metricsValidation.isValid, selectedMethod, shouldNudgeToDetails]);

  useEffect(() => {
    if (!resultSectionRef.current || !result) {
      return;
    }

    resultSectionRef.current.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }, [result]);

  const confidenceWidth = useMemo(
    () => `${Math.max(8, Math.min(100, Math.round(Number(result?.recommendation?.confidence || 0) * 100)))}%`,
    [result?.recommendation?.confidence]
  );

  const scanQualityWidth = useMemo(
    () => `${Math.max(8, Math.min(100, Math.round(Number(bodyFeatures?.scanQuality || 0) * 100)))}%`,
    [bodyFeatures?.scanQuality]
  );

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
      setShouldNudgeToDetails(false);
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

    const markReady = () => setIsCameraReady(true);
    video.addEventListener('playing', markReady);
    video.play().catch(() => undefined);

    if (video.videoWidth > 0 && !video.paused) {
      markReady();
    }

    return () => {
      video.removeEventListener('playing', markReady);
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
      setShouldNudgeToDetails(true);
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
    setShouldNudgeToDetails(false);
    startCamera();
  };

  const handleManualSubmit = async (event) => {
    event?.preventDefault?.();

    if (isSubmitting) {
      return;
    }

    if (!metricsValidation.isValid) {
      setErrorMessage(metricsValidation.message);
      focusMetricField(metricsValidation.field);
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
          heightCm: metricsValidation.parsedHeight,
          weightKg: metricsValidation.parsedWeight,
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

    if (!metricsValidation.isValid) {
      setErrorMessage(metricsValidation.message);
      focusMetricField(metricsValidation.field);
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
        heightCm: metricsValidation.parsedHeight,
        weightKg: metricsValidation.parsedWeight,
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
          heightCm: metricsValidation.parsedHeight,
          weightKg: metricsValidation.parsedWeight,
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
        className='relative max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-t-[28px] border border-white/50 bg-[#f9f6f1] shadow-[0_30px_80px_rgba(15,23,42,0.28)] sm:rounded-[32px]'
        role='dialog'
        aria-modal='true'
        aria-labelledby='fit-assistant-title'
      >
        <div className='grid gap-0 lg:grid-cols-[0.92fr_1.08fr]'>
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
                className='inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/80 text-lg text-slate-600'
                aria-label='Close fit assistant'
              >
                x
              </button>
            </div>

            <p className='mt-4 text-sm leading-6 text-slate-600'>
              {isCameraMode
                ? 'Camera mode gives you a guided scan first, then keeps your measurements directly below it so the next action is always visible.'
                : 'Manual mode keeps things simple: add your details, choose your fit preference, and review the recommended size.'}
            </p>

            <div className='mt-6 rounded-[28px] bg-white/85 p-5'>
              <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Product</p>
              <p className='mt-2 text-xl font-semibold text-slate-900'>{product.name}</p>
              <p className='mt-1 text-sm text-slate-600'>
                {product.category} / {product.subCategory}
              </p>
            </div>

            <div className='mt-5 rounded-[28px] border border-slate-200 bg-white/85 p-5'>
              <div className='flex items-start justify-between gap-4'>
                <div>
                  <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>How it works</p>
                  <p className='mt-2 text-sm leading-6 text-slate-600'>
                    {isCameraMode ? 'A simple 3-step flow.' : 'A simple 2-step flow.'}
                  </p>
                </div>
                <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                  {isCameraMode ? 'Guided flow' : 'Quick mode'}
                </span>
              </div>

              <div className='mt-4 space-y-3'>
                {(isCameraMode ? cameraStepGuide : manualStepGuide).map((item, index) => (
                  <div key={item} className='flex items-start gap-3'>
                    <span className='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-950 text-[11px] font-semibold uppercase tracking-[0.16em] text-white'>
                      {`0${index + 1}`}
                    </span>
                    <p className='pt-1 text-sm leading-6 text-slate-600'>{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className='mt-5 rounded-[28px] border border-slate-200 bg-white/85 p-5'>
              <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>
                {isCameraMode ? 'Scan tips' : 'Before you start'}
              </p>

              <div className='mt-4 space-y-3 text-sm text-slate-600'>
                {(isCameraMode ? cameraInstructions : manualHighlights).map((item) => (
                  <div key={item} className='flex items-start gap-3'>
                    <span className='mt-1 h-2 w-2 rounded-full bg-slate-500'></span>
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {isCameraMode ? (
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
            {availableMethodOptions.length > 1 ? (
              <div className='grid gap-3 sm:grid-cols-2'>
                {availableMethodOptions.map((option) => {
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
            ) : (
              <div className='rounded-[24px] border border-slate-200 bg-white px-4 py-4'>
                <p className='text-sm font-semibold uppercase tracking-[0.12em] text-slate-900'>Manual input</p>
                <p className='mt-2 text-sm leading-6 text-slate-500'>
                  Camera scan is not available on this store right now, so this assistant will use your measurements and fit preference only.
                </p>
              </div>
            )}

            <div className='mt-5 rounded-[30px] bg-slate-950 px-5 py-5 text-white shadow-[0_18px_42px_rgba(15,23,42,0.18)]'>
              <p className='text-[11px] uppercase tracking-[0.24em] text-slate-300'>{guideContent.eyebrow}</p>
              <h3 className='mt-2 text-2xl font-semibold tracking-[-0.02em]'>{guideContent.title}</h3>
              <p className='mt-3 text-sm leading-6 text-slate-300'>{guideContent.description}</p>

              <div className={`mt-5 grid gap-3 ${isCameraMode ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
                {readinessItems.map((item) => (
                  <div key={item.label} className='rounded-[22px] bg-white/10 px-4 py-3'>
                    <p className='text-[10px] uppercase tracking-[0.18em] text-slate-300'>{item.label}</p>
                    <p className='mt-1 text-sm font-medium text-white'>{item.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={`mt-5 grid gap-3 ${isCameraMode ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
              {progressSteps.map((step) => (
                <ProgressStep
                  key={step.id}
                  number={step.number}
                  title={step.title}
                  description={step.description}
                  status={step.status}
                  isComplete={step.isComplete}
                  isCurrent={step.isCurrent}
                />
              ))}
            </div>

            {isCameraMode ? (
              <>
                <section
                  className={`mt-5 rounded-[30px] border p-5 ${getStepPanelStyles({
                    isCurrent: !hasCapturedScan && !hasRecommendation,
                    isComplete: hasCapturedScan,
                  }).container}`}
                >
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div>
                      <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Step 1</p>
                      <h3 className='mt-2 text-xl font-semibold text-slate-900'>Capture your scan</h3>
                      <p className='mt-2 text-sm leading-6 text-slate-600'>
                        {hasCapturedScan
                          ? 'Your scan is saved. If the framing looks off, retake it before continuing.'
                          : 'Use one portrait frame with your upper body visible. This is the first step in the guided flow.'}
                      </p>
                    </div>

                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                      {hasCapturedScan ? 'Scan ready' : isCameraActive ? 'Camera live' : 'Waiting to start'}
                    </span>
                  </div>

                  <div className='mt-5 overflow-hidden rounded-[28px] border border-slate-200 bg-slate-950'>
                    <div className='relative aspect-[4/5] bg-gradient-to-b from-slate-900 to-slate-800'>
                      <div className='absolute left-4 top-4 z-[1] rounded-full bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-900'>
                        {hasCapturedScan ? 'Step 1 complete' : isCameraActive ? 'Camera live' : 'Ready'}
                      </div>

                      {capturedImage ? (
                        <img src={capturedImage} alt='Captured body scan preview' className='h-full w-full object-cover' />
                      ) : (
                        <>
                          <video
                            ref={videoRef}
                            autoPlay
                            muted
                            playsInline
                            className={`h-full w-full object-cover ${isCameraActive ? 'block' : 'hidden'}`}
                            style={{ transform: 'scaleX(-1)' }}
                          />
                          {!isCameraActive && (
                            <div className='flex h-full flex-col items-center justify-center px-6 text-center text-slate-200'>
                              <p className='text-[11px] uppercase tracking-[0.24em] text-slate-400'>Camera preview</p>
                              <p className='mt-3 max-w-xs text-sm leading-6 text-slate-300'>
                                Start the camera, center your upper body, and capture a single portrait frame.
                              </p>
                            </div>
                          )}
                        </>
                      )}
                    </div>

                    <div className='border-t border-white/10 px-4 py-4 text-sm text-slate-300'>
                      {capturedImage
                        ? 'Great. Continue to Step 2 below and add your measurements before you analyze the scan.'
                        : isCameraActive
                          ? 'Hold still and keep your shoulders and hips visible before capturing.'
                          : 'Portrait framing works best for the current scan pipeline.'}
                    </div>
                  </div>

                  {bodyFeatures ? (
                    <div className='mt-4 rounded-[24px] border border-slate-200 bg-white p-4'>
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

                  <div className='mt-4 flex flex-wrap gap-3'>
                    {!isCameraActive && !capturedImage ? (
                      <button
                        type='button'
                        onClick={startCamera}
                        disabled={isStartingCamera || isSubmitting}
                        className='rounded-full bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-white disabled:opacity-60'
                      >
                        {isStartingCamera ? 'Starting camera...' : 'Start camera'}
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
                          {isCameraReady ? 'Capture scan' : 'Waiting for camera...'}
                        </button>
                        <button
                          type='button'
                          onClick={stopCamera}
                          disabled={isSubmitting}
                          className='rounded-full border border-slate-300 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-slate-700 disabled:opacity-60'
                        >
                          Stop camera
                        </button>
                      </>
                    ) : null}

                    {capturedImage ? (
                      <button
                        type='button'
                        onClick={handleRetake}
                        disabled={isSubmitting}
                        className='rounded-full border border-slate-300 px-5 py-3 text-sm font-medium uppercase tracking-[0.12em] text-slate-700 disabled:opacity-60'
                      >
                        Retake scan
                      </button>
                    ) : null}
                  </div>

                  {cameraError ? (
                    <div className='mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800'>
                      {cameraError}
                    </div>
                  ) : null}
                </section>

                <section
                  ref={detailsSectionRef}
                  className={`mt-5 rounded-[30px] border p-5 ${getStepPanelStyles({
                    isCurrent: hasCapturedScan && !metricsValidation.isValid && !hasRecommendation,
                    isComplete: metricsValidation.isValid,
                  }).container}`}
                >
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div>
                      <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Step 2</p>
                      <h3 className='mt-2 text-xl font-semibold text-slate-900'>Add your body details</h3>
                      <p className='mt-2 text-sm leading-6 text-slate-600'>
                        These fields sit directly after the scan so the next action stays visible on mobile.
                      </p>
                    </div>

                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                      {metricsValidation.isValid ? 'Details ready' : 'Needs input'}
                    </span>
                  </div>

                  <div className='mt-5 grid gap-4 sm:grid-cols-2'>
                    <div>
                      <label className='mb-2 block text-sm font-medium text-slate-700'>Height (cm)</label>
                      <input
                        ref={heightInputRef}
                        type='number'
                        min='50'
                        max='260'
                        step='1'
                        inputMode='numeric'
                        enterKeyHint='next'
                        value={heightCm}
                        onChange={(event) => {
                          setHeightCm(event.target.value);
                          resetResultState();
                        }}
                        className={heightInputClasses}
                        placeholder='175'
                        required
                      />
                      {!metricsValidation.isValid && metricsValidation.field === 'height' ? (
                        <p className='mt-2 text-xs text-amber-700'>{metricsValidation.message}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className='mb-2 block text-sm font-medium text-slate-700'>Weight (kg)</label>
                      <input
                        ref={weightInputRef}
                        type='number'
                        min='20'
                        max='350'
                        step='0.5'
                        inputMode='decimal'
                        enterKeyHint='done'
                        value={weightKg}
                        onChange={(event) => {
                          setWeightKg(event.target.value);
                          resetResultState();
                        }}
                        className={weightInputClasses}
                        placeholder='72'
                        required
                      />
                      {!metricsValidation.isValid && metricsValidation.field === 'weight' ? (
                        <p className='mt-2 text-xs text-amber-700'>{metricsValidation.message}</p>
                      ) : null}
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

                  <div className='mt-4 rounded-[24px] bg-slate-50 px-4 py-4 text-sm text-slate-600'>
                    {metricsValidation.isValid
                      ? 'Step 2 is complete. Continue to the final step below to analyze the scan.'
                      : 'Add the missing detail above and the assistant will be ready to analyze your scan.'}
                  </div>
                </section>

                <section
                  className={`mt-5 rounded-[30px] border p-5 ${getStepPanelStyles({
                    isCurrent: hasCapturedScan && metricsValidation.isValid && !hasRecommendation,
                    isComplete: hasRecommendation,
                  }).container}`}
                >
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div>
                      <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Step 3</p>
                      <h3 className='mt-2 text-xl font-semibold text-slate-900'>Analyze and get your size</h3>
                      <p className='mt-2 text-sm leading-6 text-slate-600'>
                        Once both the scan and your measurements are ready, you can run the fit analysis here.
                      </p>
                    </div>

                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                      {hasRecommendation ? 'Ready' : 'Final step'}
                    </span>
                  </div>

                  <div className='mt-5 grid gap-3 sm:grid-cols-2'>
                    <div
                      className={`rounded-[24px] border px-4 py-4 ${
                        hasCapturedScan ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className='text-[10px] uppercase tracking-[0.18em] text-slate-500'>Scan status</p>
                      <p className='mt-2 text-sm font-semibold text-slate-900'>
                        {hasCapturedScan ? 'Captured and ready' : 'Capture your scan first'}
                      </p>
                      <p className='mt-1 text-sm leading-6 text-slate-600'>
                        {hasCapturedScan
                          ? 'You can retake it above if the framing does not look right.'
                          : 'Go back to Step 1 and capture a single clear portrait frame.'}
                      </p>
                    </div>

                    <div
                      className={`rounded-[24px] border px-4 py-4 ${
                        metricsValidation.isValid ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-slate-50'
                      }`}
                    >
                      <p className='text-[10px] uppercase tracking-[0.18em] text-slate-500'>Details status</p>
                      <p className='mt-2 text-sm font-semibold text-slate-900'>
                        {metricsValidation.isValid ? 'Measurements are ready' : 'Add your measurements first'}
                      </p>
                      <p className='mt-1 text-sm leading-6 text-slate-600'>
                        {metricsValidation.isValid
                          ? `${metricsValidation.parsedHeight} cm, ${metricsValidation.parsedWeight} kg, ${selectedFitLabel.toLowerCase()} fit.`
                          : metricsValidation.message}
                      </p>
                    </div>
                  </div>

                  <button
                    type='button'
                    onClick={handleCameraAnalyze}
                    disabled={isSubmitting}
                    className='mt-5 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-white disabled:opacity-60'
                  >
                    {isSubmitting
                      ? 'Analyzing your fit...'
                      : !hasCapturedScan
                        ? 'Capture scan to continue'
                        : !metricsValidation.isValid
                          ? 'Review details to continue'
                          : 'Analyze fit'}
                  </button>

                  <p className='mt-3 text-sm leading-6 text-slate-500'>
                    {hasCapturedScan && metricsValidation.isValid
                      ? 'Everything needed for the camera-assisted recommendation is ready.'
                      : 'This button stays active so we can guide you to the missing step instead of leaving you with a dead end.'}
                  </p>
                </section>
              </>
            ) : (
              <form onSubmit={handleManualSubmit} className='mt-5 space-y-5'>
                <section
                  ref={detailsSectionRef}
                  className={`rounded-[30px] border p-5 ${getStepPanelStyles({
                    isCurrent: !metricsValidation.isValid && !hasRecommendation,
                    isComplete: metricsValidation.isValid,
                  }).container}`}
                >
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div>
                      <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Step 1</p>
                      <h3 className='mt-2 text-xl font-semibold text-slate-900'>Add your body details</h3>
                      <p className='mt-2 text-sm leading-6 text-slate-600'>
                        This is everything the manual fit assistant needs to recommend a size.
                      </p>
                    </div>

                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                      {metricsValidation.isValid ? 'Details ready' : 'Needs input'}
                    </span>
                  </div>

                  <div className='mt-5 grid gap-4 sm:grid-cols-2'>
                    <div>
                      <label className='mb-2 block text-sm font-medium text-slate-700'>Height (cm)</label>
                      <input
                        ref={heightInputRef}
                        type='number'
                        min='50'
                        max='260'
                        step='1'
                        inputMode='numeric'
                        enterKeyHint='next'
                        value={heightCm}
                        onChange={(event) => {
                          setHeightCm(event.target.value);
                          resetResultState();
                        }}
                        className={heightInputClasses}
                        placeholder='175'
                        required
                      />
                      {!metricsValidation.isValid && metricsValidation.field === 'height' ? (
                        <p className='mt-2 text-xs text-amber-700'>{metricsValidation.message}</p>
                      ) : null}
                    </div>

                    <div>
                      <label className='mb-2 block text-sm font-medium text-slate-700'>Weight (kg)</label>
                      <input
                        ref={weightInputRef}
                        type='number'
                        min='20'
                        max='350'
                        step='0.5'
                        inputMode='decimal'
                        enterKeyHint='done'
                        value={weightKg}
                        onChange={(event) => {
                          setWeightKg(event.target.value);
                          resetResultState();
                        }}
                        className={weightInputClasses}
                        placeholder='72'
                        required
                      />
                      {!metricsValidation.isValid && metricsValidation.field === 'weight' ? (
                        <p className='mt-2 text-xs text-amber-700'>{metricsValidation.message}</p>
                      ) : null}
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
                </section>

                <section
                  className={`rounded-[30px] border p-5 ${getStepPanelStyles({
                    isCurrent: metricsValidation.isValid && !hasRecommendation,
                    isComplete: hasRecommendation,
                  }).container}`}
                >
                  <div className='flex flex-wrap items-start justify-between gap-4'>
                    <div>
                      <p className='text-[11px] uppercase tracking-[0.24em] text-slate-500'>Step 2</p>
                      <h3 className='mt-2 text-xl font-semibold text-slate-900'>Review your recommendation</h3>
                      <p className='mt-2 text-sm leading-6 text-slate-600'>
                        We compare your details with this product&apos;s garment profile to recommend the best size.
                      </p>
                    </div>

                    <span className='rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600'>
                      {hasRecommendation ? 'Ready' : 'Final step'}
                    </span>
                  </div>

                  <button
                    type='submit'
                    disabled={isSubmitting}
                    className='mt-5 w-full rounded-2xl bg-slate-950 px-5 py-3 text-sm font-medium uppercase tracking-[0.16em] text-white disabled:opacity-60'
                  >
                    {isSubmitting ? 'Analyzing your fit...' : 'Find my size'}
                  </button>

                  <p className='mt-3 text-sm leading-6 text-slate-500'>
                    {metricsValidation.isValid
                      ? 'Your details are ready. Run the fit check whenever you are ready.'
                      : 'If something is missing, we will take you straight to the field that needs attention.'}
                  </p>
                </section>
              </form>
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
              <div
                ref={resultSectionRef}
                className='mt-2 rounded-[30px] border border-slate-200 bg-white p-5 shadow-[0_10px_30px_rgba(15,23,42,0.06)]'
              >
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
