const GOOGLE_IDENTITY_SCRIPT_ID = 'google-identity-services';
const GOOGLE_IDENTITY_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let googleIdentityScriptPromise = null;

const loadGoogleIdentityScript = () => {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Identity Services can only load in the browser.'));
  }

  if (window.google?.accounts?.id) {
    return Promise.resolve(window.google);
  }

  if (googleIdentityScriptPromise) {
    return googleIdentityScriptPromise;
  }

  googleIdentityScriptPromise = new Promise((resolve, reject) => {
    const handleResolve = () => resolve(window.google);
    const handleReject = () => {
      googleIdentityScriptPromise = null;
      reject(new Error('Failed to load Google Identity Services.'));
    };

    const existingScript = document.getElementById(GOOGLE_IDENTITY_SCRIPT_ID);

    if (existingScript) {
      existingScript.addEventListener('load', handleResolve, { once: true });
      existingScript.addEventListener('error', handleReject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = GOOGLE_IDENTITY_SCRIPT_ID;
    script.src = GOOGLE_IDENTITY_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = handleResolve;
    script.onerror = handleReject;
    document.head.appendChild(script);
  });

  return googleIdentityScriptPromise;
};

export { loadGoogleIdentityScript };
