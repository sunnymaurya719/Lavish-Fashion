import * as Ably from 'ably';
import axios from 'axios';
import { BACKEND_URL } from '../config/api';

const DEFAULT_CHANNEL_NAME = 'admin.orders';
const DEFAULT_EVENT_NAME = 'order.upsert';
const RETRY_BACKOFF_MS = [1000, 2500, 5000, 10000];

const createAdminOrderRealtimeClient = ({
  token,
  onOrderUpsert,
  onConnectionStatusChange,
  channelName = DEFAULT_CHANNEL_NAME,
  eventName = DEFAULT_EVENT_NAME,
}) => {
  let disposed = false;
  let channel = null;
  let realtime = null;
  let retryAttempt = 0;
  let retryTimer = null;

  const notifyStatus = (status, message = '') => {
    if (typeof onConnectionStatusChange === 'function') {
      onConnectionStatusChange({ status, message });
    }
  };

  const clearRetryTimer = () => {
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
  };

  const connect = async () => {
    if (disposed) {
      return;
    }

    notifyStatus('connecting', 'Connecting live updates...');

    try {
      realtime = new Ably.Realtime({
        authCallback: async (_tokenParams, callback) => {
          try {
            const response = await axios.post(
              BACKEND_URL + '/api/realtime/admin-token',
              {},
              { headers: { token } }
            );

            if (!response.data.success) {
              throw new Error(response.data.message || 'Realtime auth failed');
            }

            callback(null, response.data.tokenRequest);
          } catch (error) {
            callback(error);
          }
        },
        closeOnUnload: true,
      });

      realtime.connection.on((stateChange) => {
        if (disposed) {
          return;
        }

        if (stateChange.current === 'connected') {
          retryAttempt = 0;
          notifyStatus('connected', 'Live updates connected');
          return;
        }

        if (stateChange.current === 'connecting') {
          notifyStatus('connecting', 'Reconnecting live updates...');
          return;
        }

        if (stateChange.current === 'failed' || stateChange.current === 'suspended' || stateChange.current === 'disconnected') {
          notifyStatus('disconnected', 'Live updates disconnected');
        }
      });

      channel = realtime.channels.get(channelName);
      await channel.subscribe(eventName, (message) => {
        if (disposed) {
          return;
        }

        if (typeof onOrderUpsert === 'function') {
          onOrderUpsert(message?.data || null, message);
        }
      });

      notifyStatus('connected', 'Live updates connected');
    } catch (error) {
      if (disposed) {
        return;
      }

      notifyStatus('disconnected', error?.message || 'Live updates disconnected');

      clearRetryTimer();
      const waitMs = RETRY_BACKOFF_MS[Math.min(retryAttempt, RETRY_BACKOFF_MS.length - 1)];
      retryAttempt += 1;
      retryTimer = setTimeout(() => {
        connect();
      }, waitMs);
    }
  };

  connect();

  return () => {
    disposed = true;
    clearRetryTimer();

    if (channel) {
      try {
        channel.unsubscribe(eventName);
      } catch {
        // Ignore unsubscribe errors during teardown.
      }
    }

    if (realtime) {
      try {
        realtime.close();
      } catch {
        // Ignore close errors during teardown.
      }
    }
  };
};

export { createAdminOrderRealtimeClient };
