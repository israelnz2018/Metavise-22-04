// React's typings for <video> don't include `referrerPolicy`, but the
// HTML spec does support it and browsers honour it for fetching media.
// We use it to send Generative Language API URLs without a referrer
// (those endpoints reject CORS preflights with referrer set).
import 'react';

declare module 'react' {
  interface VideoHTMLAttributes<T> {
    referrerPolicy?: HTMLAttributeReferrerPolicy;
  }
}
