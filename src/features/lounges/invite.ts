/**
 * Sharing a lounge invite code.
 *
 * `expo-clipboard` is not installed in this project, so there is no single API
 * that works everywhere:
 *   web    -> navigator.clipboard, which is a real copy the user can paste.
 *   native -> the OS share sheet, which is the better affordance anyway
 *             (people invite friends through a messaging app, not a buffer).
 *
 * If expo-clipboard is ever added, swap the web branch for
 * `Clipboard.setStringAsync(code)` on both platforms and keep this signature.
 */

import { Platform, Share } from 'react-native';

export type InviteShareResult = 'copied' | 'shared' | 'dismissed';

type ClipboardLike = { writeText: (text: string) => Promise<void> };

function webClipboard(): ClipboardLike | null {
  const nav: unknown = (globalThis as { navigator?: unknown }).navigator;
  if (typeof nav !== 'object' || nav === null) return null;

  const clipboard: unknown = (nav as { clipboard?: unknown }).clipboard;
  if (typeof clipboard !== 'object' || clipboard === null) return null;

  const writeText: unknown = (clipboard as { writeText?: unknown }).writeText;
  return typeof writeText === 'function' ? (clipboard as ClipboardLike) : null;
}

export function inviteMessage(loungeName: string, code: string): string {
  return `Join "${loungeName}" on Aux — invite code ${code}`;
}

/**
 * Hands the invite code to the user however this platform allows.
 * Throws only when neither path exists, so callers can toast a real failure
 * instead of pretending a copy happened.
 */
export async function shareInviteCode(
  loungeName: string,
  code: string,
): Promise<InviteShareResult> {
  if (Platform.OS === 'web') {
    const clipboard = webClipboard();
    if (!clipboard) {
      throw new Error(`Copy this code manually: ${code}`);
    }
    await clipboard.writeText(code);
    return 'copied';
  }

  const result = await Share.share({
    message: inviteMessage(loungeName, code),
    // Android ignores `title` in the sheet body but uses it for the chooser.
    title: loungeName,
  });

  return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
}
