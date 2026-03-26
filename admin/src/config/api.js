const normalizeUrl = (value) => String(value || '').trim().replace(/\/$/, '');

const DEFAULT_BACKEND_URL = 'http://localhost:4000';

const BACKEND_URL = normalizeUrl(import.meta.env.VITE_BACKEND_URL) || DEFAULT_BACKEND_URL;

export { BACKEND_URL, DEFAULT_BACKEND_URL, normalizeUrl };
