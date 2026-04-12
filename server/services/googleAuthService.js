import { OAuth2Client } from 'google-auth-library';

const normalizeEnvValue = (value) => String(value || '').trim();

const getGoogleClientId = () => normalizeEnvValue(process.env.GOOGLE_CLIENT_ID);

const isGoogleAuthConfigured = () => Boolean(getGoogleClientId());

const oauthClient = new OAuth2Client();

class GoogleAuthConfigurationError extends Error {
    constructor(message = 'Google authentication is not configured') {
        super(message);
        this.name = 'GoogleAuthConfigurationError';
    }
}

class GoogleTokenVerificationError extends Error {
    constructor(message = 'Unable to verify Google credential', options = {}) {
        super(message, options);
        this.name = 'GoogleTokenVerificationError';
    }
}

const normalizeBoolean = (value) => value === true || String(value || '').trim().toLowerCase() === 'true';

const isGoogleEmailAuthoritative = (payload = {}) => {
    const email = normalizeEnvValue(payload.email).toLowerCase();
    const hostedDomain = normalizeEnvValue(payload.hd);
    const emailVerified = normalizeBoolean(payload.email_verified);

    return email.endsWith('@gmail.com') || (emailVerified && Boolean(hostedDomain));
};

const verifyGoogleIdToken = async (idToken) => {
    const googleClientId = getGoogleClientId();

    if (!googleClientId) {
        throw new GoogleAuthConfigurationError();
    }

    const normalizedToken = normalizeEnvValue(idToken);

    if (!normalizedToken) {
        throw new GoogleTokenVerificationError('Google credential is required');
    }

    try {
        const ticket = await oauthClient.verifyIdToken({
            idToken: normalizedToken,
            audience: googleClientId
        });

        const payload = ticket.getPayload();

        if (!payload?.sub || !payload?.email) {
            throw new GoogleTokenVerificationError('Google account details are incomplete');
        }

        return payload;
    } catch (error) {
        if (error instanceof GoogleTokenVerificationError) {
            throw error;
        }

        throw new GoogleTokenVerificationError('Unable to verify Google credential', { cause: error });
    }
};

export {
    GoogleAuthConfigurationError,
    GoogleTokenVerificationError,
    getGoogleClientId,
    isGoogleAuthConfigured,
    isGoogleEmailAuthoritative,
    verifyGoogleIdToken
};
