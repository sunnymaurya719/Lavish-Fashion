# Google OAuth 2.0 Implementation Plan

## Current Auth Flow

### Client

- `client/src/pages/Login.jsx` handles both login and signup.
- Email/password login posts to `POST /api/user/login`.
- Email/password signup posts to `POST /api/user/register`.
- On success, the client stores the returned JWT in `localStorage` as `token`.
- `client/src/context/ShopContext.jsx` uses that token for authenticated cart, wishlist, and profile requests.
- `client/src/context/ShopContext.jsx` also fetches `GET /api/system/bootstrap`, which is the best place to expose public runtime auth config such as the Google client id.

### Server

- `server/routes/userRoute.js` exposes the auth endpoints.
- `server/controllers/userController.js` verifies local credentials, creates users, and signs the app JWT with `JWT_SECRET`.
- `server/models/userModel.js` stores customer auth and profile data in MongoDB.
- `server/middleware/auth.js` reads the app JWT from `token` or `Authorization: Bearer ...`.
- The rest of the system already trusts the app JWT, so Google should end by minting the same JWT instead of introducing a second session model.

## Google Strategy

Use Google Identity Services on the client to obtain a Google ID token, then send that token to the server:

1. Client renders the official Google button.
2. Google returns an ID token.
3. Server verifies the ID token against `GOOGLE_CLIENT_ID`.
4. Server finds, links, or creates the Lavish Fashion user.
5. Server returns the existing app JWT.
6. Client stores that JWT exactly like the email/password flow.

This keeps cart, wishlist, orders, profile, and checkout behavior unchanged.

## Implemented Changes

### Server

- Added `POST /api/user/google`.
- Added `server/services/googleAuthService.js` to verify Google ID tokens with `google-auth-library`.
- Extended `userModel` to support:
  - `googleId`
  - `googleEmailVerified`
  - `googlePicture`
  - `googleLinkedAt`
  - `googleLastLoginAt`
  - `avatarUrl`
  - `authProvider`
- Kept email/password login intact.
- Added a guard so Google-only accounts are prompted to continue with Google instead of failing password comparison.
- Reused referral-code handling for first-time Google signups.
- Exposed Google runtime config through `GET /api/system/bootstrap`:
  - `bootstrap.features.googleAuthEnabled`
  - `bootstrap.auth.googleEnabled`
  - `bootstrap.auth.googleClientId`

### Client

- Added a Google Identity script loader in `client/src/utils/googleIdentity.js`.
- Replaced the placeholder Google toast in `client/src/pages/Login.jsx` with the official Google button.
- Sent the Google ID token to `POST /api/user/google`.
- Kept token storage and post-login flow unchanged.
- Updated `ShopContext` logout/session-clear flow to call `google.accounts.id.disableAutoSelect()` when available.

## Account Linking Rules

- Existing Google-linked user by `googleId`: sign in directly.
- Existing local user with the same email and no linked Google account:
  - link automatically only when the Google account email is authoritative
  - otherwise require the user to continue with existing credentials first
- No existing user: create a new Google-backed account and return the app JWT.

## Environment Changes

Add this to `server/.env`:

```env
GOOGLE_CLIENT_ID=your_google_web_client_id.apps.googleusercontent.com
```

No client-side Google env var is required because the client reads the public Google client id from `/api/system/bootstrap`.

## Google Cloud Console Setup

Create or use a Web OAuth client in Google Cloud and add these Authorized JavaScript origins:

- `http://localhost:5173`
- `https://lavishfashion.vercel.app`

If you later switch from popup mode to redirect mode, you will also need to configure Authorized redirect URIs. The current implementation uses popup mode, so the key requirement is the authorized origin list plus the shared `GOOGLE_CLIENT_ID`.

## Test Checklist

### Local

1. Set `GOOGLE_CLIENT_ID` in `server/.env`.
2. Start `server` and `client`.
3. Open `/login`.
4. Confirm the Google button renders.
5. Test existing email/password login still works.
6. Test first-time Google signup creates a user and logs in.
7. Test returning Google login reuses the same account.
8. Test wishlist/cart still work after Google login.

### Edge Cases

1. Google account with an email that already belongs to a local account.
2. Google login with an invalid or expired credential.
3. Google disabled or missing server config.
4. Signup mode with a referral code in the URL query string.

## Key Files

- `server/controllers/userController.js`
- `server/services/googleAuthService.js`
- `server/models/userModel.js`
- `server/routes/userRoute.js`
- `server/controllers/systemController.js`
- `client/src/pages/Login.jsx`
- `client/src/context/ShopContext.jsx`
- `client/src/utils/googleIdentity.js`

## Notes

- The app still uses one session model: Lavish Fashion JWTs.
- Google is only an identity proof source.
- This approach matches Google’s current web sign-in pattern: official button on the client, ID token verification on the server, then your own app session.
