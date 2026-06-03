const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

function normalizeError(data, fallback) {
  if (typeof data === 'string' && data.trim()) {
    return data;
  }

  if (Array.isArray(data?.message)) {
    return data.message.join('. ');
  }

  return data?.message || fallback;
}

export async function apiPost(path, payload, fallbackError = 'Request failed') {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(normalizeError(data, fallbackError));
  }

  return data;
}
