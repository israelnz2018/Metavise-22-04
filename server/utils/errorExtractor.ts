// Walks an arbitrary object/array looking for the first usable error message
// in common field names. Used by both processDataError (errors from try/catch)
// and formatApiError (errors from fetch responses).
function extractFromObject(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;

  if (Array.isArray(obj)) {
    const msgs = obj
      .map((item) => (typeof item === 'string' ? item : extractFromObject(item)))
      .filter(Boolean) as string[];
    return msgs.length > 0 ? msgs.join('; ') : null;
  }

  const fields = ['message', 'msg', 'error', 'errors', 'detail', 'reason', 'description'];
  const record = obj as Record<string, unknown>;
  for (const field of fields) {
    const val = record[field];
    if (val) {
      if (typeof val === 'string') return val;
      if (typeof val === 'object') {
        const sub = extractFromObject(val);
        if (sub) return sub;
      }
    }
  }
  return null;
}

// Extracts a useful message from a thrown error. If err.message looks like JSON,
// parses it and digs into common fields.
export function processDataError(err: unknown): string {
  if (!err) return 'Erro desconhecido';

  const msg = (err as { message?: string }).message ?? String(err);

  if (typeof msg === 'string' && (msg.trim().startsWith('{') || msg.trim().startsWith('['))) {
    try {
      const data = JSON.parse(msg);
      const extracted = extractFromObject(data);
      if (extracted) return extracted;
    } catch {
      // Ignore parse error and return the raw string
    }
  }

  return msg;
}

// Extracts a useful message from an external API's error response body.
// Used for AssemblyAI, ZapCap, HeyGen, etc.
export async function formatApiError(response: Response): Promise<string> {
  try {
    const errorBody = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(errorBody);
    } catch {
      return errorBody || `Status ${response.status}: ${response.statusText}`;
    }

    const result = extractFromObject(data);
    if (result) return result;

    return JSON.stringify(data);
  } catch {
    return `Status ${response.status}: ${response.statusText}`;
  }
}
