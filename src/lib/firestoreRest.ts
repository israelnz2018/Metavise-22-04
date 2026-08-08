import type { User as FirebaseUser } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

// Fallback via API REST do Firestore pra criar projeto quando o SDK trava
// (timeout). Extraído do App.tsx — puro, sem dependência de state do
// componente. Usado só por handleCreateProject.
export const CREATE_PROJECT_TIMEOUT_MS = 8000;

const toFirestoreValue = (value: any): any => {
  if (value === null) return { nullValue: null };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value)
            .filter(([, entryValue]) => entryValue !== undefined)
            .map(([key, entryValue]) => [key, toFirestoreValue(entryValue)])
        ),
      },
    };
  }
  return { stringValue: String(value) };
};

const toFirestoreFields = (data: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, toFirestoreValue(value)])
  );

export const createProjectViaRest = async (
  user: FirebaseUser,
  documentId: string,
  projectData: Record<string, any>
): Promise<string> => {
  const token = await user.getIdToken();
  const databaseId = encodeURIComponent(firebaseConfig.firestoreDatabaseId || '(default)');
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${databaseId}/documents/projects?documentId=${documentId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: toFirestoreFields({
        ...projectData,
        createdAt: new Date(),
      }),
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    if (response.status === 409 && text.includes('ALREADY_EXISTS')) return documentId;
    try {
      const payload = JSON.parse(text);
      const apiError = payload?.error;
      const detail = [apiError?.status, apiError?.code, apiError?.message]
        .filter(Boolean)
        .join(' - ');
      throw new Error(detail || text || `Firestore REST create failed (${response.status})`);
    } catch (parseErr) {
      if (parseErr instanceof SyntaxError) {
        throw new Error(text || `Firestore REST create failed (${response.status})`);
      }
      throw parseErr;
    }
  }

  return documentId;
};
