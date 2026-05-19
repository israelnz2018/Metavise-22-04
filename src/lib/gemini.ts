// Builds a `?key=...&alt=media` URL for Google's GenerativeLanguage API so
// the SPA can fetch generated assets (videos/images) directly. Used by
// the avatar preview, the video gallery, and a couple of poster fallbacks.
//
// Non-Google URLs and local /generated paths pass through unchanged.
export const getAuthorizedUrl = (url: string | null | undefined, apiKey?: string) => {
  if (!url) return null;

  let processedUrl = url;

  if (processedUrl.startsWith('v1beta/')) {
    processedUrl = `https://generativelanguage.googleapis.com/${processedUrl}`;
  }

  if (
    processedUrl.startsWith('/generated') ||
    processedUrl.startsWith('blob:') ||
    !processedUrl.startsWith('http')
  ) {
    return processedUrl;
  }

  try {
    const urlObj = new URL(processedUrl);
    if (urlObj.hostname.includes('generativelanguage.googleapis.com')) {
      urlObj.pathname = urlObj.pathname.replace(':download', '');

      let key = apiKey;
      if (!key) {
        const g = window as any;
        key =
          g.process?.env?.GEMINI_API_KEY ||
          g.process?.env?.API_KEY ||
          g.import?.meta?.env?.VITE_GEMINI_API_KEY ||
          (typeof process !== 'undefined'
            ? process.env.GEMINI_API_KEY || (process.env as any).API_KEY
            : undefined);
      }

      if (!key) {
        console.warn('[gemini.getAuthorizedUrl] Missing API key for', url);
        return url;
      }

      if (!urlObj.searchParams.has('alt')) {
        urlObj.searchParams.set('alt', 'media');
      }
      urlObj.searchParams.set('key', key);
      return urlObj.toString();
    }
  } catch (e) {
    console.warn('[gemini.getAuthorizedUrl] URL parse failed for', url, e);
  }

  return url;
};
