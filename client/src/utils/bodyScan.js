const DEFAULT_CAPTURE_OPTIONS = {
  maxWidth: 960,
  maxHeight: 960,
  quality: 0.72,
};

const supportsCameraCapture = () =>
  typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);

const stopMediaStream = (stream) => {
  if (!stream) {
    return;
  }

  stream.getTracks().forEach((track) => track.stop());
};

const captureVideoFrame = (videoElement, options = {}) => {
  const { maxWidth, maxHeight, quality } = { ...DEFAULT_CAPTURE_OPTIONS, ...options };

  if (!videoElement?.videoWidth || !videoElement?.videoHeight) {
    throw new Error('Camera preview is not ready yet.');
  }

  const scaleFactor = Math.min(1, maxWidth / videoElement.videoWidth, maxHeight / videoElement.videoHeight);
  const targetWidth = Math.max(1, Math.round(videoElement.videoWidth * scaleFactor));
  const targetHeight = Math.max(1, Math.round(videoElement.videoHeight * scaleFactor));
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error('Unable to prepare the scan image.');
  }

  canvas.width = targetWidth;
  canvas.height = targetHeight;
  context.drawImage(videoElement, 0, 0, targetWidth, targetHeight);

  return canvas.toDataURL('image/jpeg', quality);
};

const getCameraErrorMessage = (error) => {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return 'Camera access was blocked. Please allow camera access or use manual measurements.';
  }

  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Please use manual measurements instead.';
  }

  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') {
    return 'Your camera is busy in another app. Close it there and try again.';
  }

  return 'Unable to start the camera right now. Please try again or use manual measurements.';
};

export { captureVideoFrame, getCameraErrorMessage, stopMediaStream, supportsCameraCapture };
