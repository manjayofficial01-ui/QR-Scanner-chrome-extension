/* QR Scanner · pure payload logic (shared by extension pages and service worker) */
'use strict';

self.QRPayload = (() => {
  const TYPES = {
    url:     { label: 'Link',    icon: 'link' },
    wifi:    { label: 'Wi-Fi',   icon: 'wifi' },
    email:   { label: 'Email',   icon: 'mail' },
    phone:   { label: 'Phone',   icon: 'phone' },
    sms:     { label: 'SMS',     icon: 'sms' },
    geo:     { label: 'Location',icon: 'geo' },
    contact: { label: 'Contact', icon: 'contact' },
    event:   { label: 'Event',   icon: 'event' },
    auth:    { label: '2FA Key', icon: 'shield' },
    text:    { label: 'Text',    icon: 'text' },
  };

  function detectType(text) {
    const t = text.trim();
    if (/^https?:\/\//i.test(t)) return 'url';
    if (/^WIFI:/i.test(t)) return 'wifi';
    if (/^mailto:/i.test(t) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'email';
    if (/^tel:/i.test(t)) return 'phone';
    if (/^(sms:|smsto:)/i.test(t)) return 'sms';
    if (/^geo:/i.test(t)) return 'geo';
    if (/^BEGIN:VCARD/i.test(t)) return 'contact';
    if (/^BEGIN:VEVENT/i.test(t)) return 'event';
    if (/^otpauth:\/\//i.test(t)) return 'auth';
    return 'text';
  }

  function makeEntry(text, source) {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text,
      type: detectType(text),
      source,
      ts: Date.now(),
    };
  }

  return { TYPES, detectType, makeEntry };
})();