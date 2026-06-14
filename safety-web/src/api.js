const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

const GENERIC_RATE_LIMIT_MESSAGE = 'Bạn thao tác quá nhiều lần. Vui lòng chờ một chút rồi thử lại.';

export class ApiError extends Error {
  constructor(message, { status, retryAfterSeconds } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isTechnicalMessage(message) {
  const lower = String(message || '').toLowerCase();

  return (
    lower.includes('throttlerexception') ||
    lower.includes('exception:') ||
    lower.includes('stack') ||
    lower.includes('internal server error') ||
    lower.includes('too many requests')
  );
}

function normalizeError(data, fallback, status) {
  const rawMessage = Array.isArray(data?.message)
    ? data.message.join('. ')
    : typeof data === 'string'
      ? data
      : data?.message;

  if (status === 429 && isTechnicalMessage(rawMessage)) {
    return GENERIC_RATE_LIMIT_MESSAGE;
  }

  if (rawMessage && !isTechnicalMessage(rawMessage)) {
    return rawMessage;
  }

  if (status === 429) {
    return GENERIC_RATE_LIMIT_MESSAGE;
  }

  return fallback;
}

async function parseResponse(response, fallbackError) {
  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new ApiError(normalizeError(data, fallbackError, response.status), {
      status: response.status,
      retryAfterSeconds: data?.retryAfterSeconds,
    });
  }

  return data;
}

export async function apiGet(path, headers = {}, fallbackError = 'Request failed') {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'GET',
    headers,
  });

  return parseResponse(response, fallbackError);
}

export async function apiPost(path, payload, fallbackError = 'Request failed') {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  return parseResponse(response, fallbackError);
}
