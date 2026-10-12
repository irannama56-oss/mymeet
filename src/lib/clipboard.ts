/**
 * Clipboard helper.
 *
 * `navigator.clipboard` only exists in secure contexts (https:// or localhost).
 * When the app is served over plain http on a LAN IP, or embedded in an iframe
 * without the clipboard-write permission, `navigator.clipboard.writeText` is
 * either undefined or rejects — which previously left the "Copied" badge lying
 * to the user while nothing was copied.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;

  // 1. Modern async clipboard API
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }

  // 2. Legacy execCommand fallback
  try {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-1000px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
