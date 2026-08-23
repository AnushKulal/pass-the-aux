/**
 * Checking for, downloading and installing a new APK from inside the app.
 *
 * This is the OTHER kind of update, and the distinction matters:
 *
 *   OTA (@/lib/updates)  ships JavaScript. Instant, silent, no permission.
 *                        Cannot change native code.
 *   APK (this file)      ships the whole app. Needed whenever a native module,
 *                        a permission or the Expo SDK changes. Requires the
 *                        user to approve an install.
 *
 * HOW A BUILD IDENTIFIES ITSELF: every CI build stamps `versionCode` from the
 * workflow run number and publishes `build-info.json` beside the APK on the
 * "latest" release. Comparing that number against this build's own versionCode
 * is the whole check. Before that stamping existed every build claimed
 * versionCode 1, so nothing could be newer than anything.
 *
 * WHY A RELEASE ASSET RATHER THAN THE GITHUB API: unauthenticated API calls are
 * capped at 60/hour per IP. A phone that checks for updates must never be rate
 * limited into believing it is current. Asset downloads have no such cap.
 *
 * WHY IN-PLACE INSTALL WORKS AT ALL: `expo prebuild` copies a fixed template
 * debug keystore (its certificate is dated 2014, identical on every run), and
 * the release build is signed with it. Same key every build means Android
 * treats a new APK as an upgrade rather than a conflicting app. If signing ever
 * moves to a real release keystore, that key must be stable for the same reason.
 */

import * as Application from 'expo-application';
import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

const REPO = 'AnushKulal/pass-the-aux';
const RELEASE_BASE = `https://github.com/${REPO}/releases/download/latest`;

export const BUILD_INFO_URL = `${RELEASE_BASE}/build-info.json`;
export const APK_URL = `${RELEASE_BASE}/aux-latest.apk`;

/** Written by the APK workflow's "Publish to the latest release" step. */
export type BuildInfo = {
  versionCode: number;
  versionName: string;
  patch: number;
  commit: string;
  builtAt: string;
  apk: string;
  sizeBytes: number;
  notes: string[];
};

export type ApkCheck =
  | { kind: 'current'; installed: number }
  | { kind: 'available'; installed: number; latest: BuildInfo }
  /** iOS or web: there is no sideloading story, and there should not be one. */
  | { kind: 'unsupported' }
  | { kind: 'error'; message: string };

/** Read a property without asserting the shape of anything above it. */
function at(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function toStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    : [];
}

/**
 * The versionCode of the build currently installed.
 *
 * `nativeBuildVersion` is the versionCode on Android and the build number on
 * iOS, and is null in Expo Go. Zero when unknown, which makes any real build
 * look newer — the safe direction, since offering an update the user does not
 * need costs a tap and missing one they do need costs the fix.
 */
export function installedVersionCode(): number {
  try {
    const raw = Application.nativeBuildVersion;
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  } catch {
    /*
      Reached when the JavaScript knows about expo-application but the running
      binary does not — an over-the-air update carrying this file to a build
      made before the module was added. Expo's native proxies throw on access
      rather than on import, so this is where that mismatch surfaces.

      It must not throw: this is called during Settings' render, and a throw
      there takes the whole screen down. Zero reads as "unknown", the row says
      "Build number unavailable", and everything else still works.
    */
    return 0;
  }
}

function parseBuildInfo(value: unknown): BuildInfo | null {
  const versionCode = at(value, 'versionCode');
  if (typeof versionCode !== 'number' || !Number.isFinite(versionCode)) return null;

  const sizeBytes = at(value, 'sizeBytes');

  return {
    versionCode,
    versionName: typeof at(value, 'versionName') === 'string' ? (at(value, 'versionName') as string) : '',
    patch: typeof at(value, 'patch') === 'number' ? (at(value, 'patch') as number) : 0,
    commit: typeof at(value, 'commit') === 'string' ? (at(value, 'commit') as string) : '',
    builtAt: typeof at(value, 'builtAt') === 'string' ? (at(value, 'builtAt') as string) : '',
    apk: typeof at(value, 'apk') === 'string' ? (at(value, 'apk') as string) : 'aux-latest.apk',
    sizeBytes: typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) ? sizeBytes : 0,
    notes: toStrings(at(value, 'notes')),
  };
}

/**
 * Ask whether a newer APK has been published.
 *
 * Never throws: every failure is a returned `error`, because this runs behind a
 * button the user pressed and a thrown promise there is an unexplained dead UI.
 */
export async function checkForNewApk(): Promise<ApkCheck> {
  if (Platform.OS !== 'android') return { kind: 'unsupported' };

  try {
    // `cache: 'no-store'` matters: the release asset keeps its URL forever and
    // is replaced in place, so a cached copy would report an old build as the
    // newest one indefinitely.
    const response = await fetch(BUILD_INFO_URL, { cache: 'no-store' });
    if (!response.ok) {
      return { kind: 'error', message: `Update server returned ${response.status}` };
    }

    const latest = parseBuildInfo(await response.json());
    if (!latest) return { kind: 'error', message: 'Could not read the build information' };

    const installed = installedVersionCode();
    return latest.versionCode > installed
      ? { kind: 'available', installed, latest }
      : { kind: 'current', installed };
  } catch {
    return { kind: 'error', message: 'Could not reach the update server' };
  }
}

/**
 * Download the APK and hand it to Android's package installer.
 *
 * Resolves once the installer has been handed the file — NOT once the app is
 * installed. Android takes over from there, shows its own confirmation, and
 * this process is replaced if the user accepts. There is deliberately nothing
 * after the intent: any "installed!" state we set here would be a lie.
 *
 * The first time through, Android will bounce the user to "Allow from this
 * source" because installing packages is a per-app permission. Declining is a
 * normal outcome, not an error, and looks identical to accepting from here.
 */
export async function downloadAndInstallApk(latest: BuildInfo): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('In-app installation is Android only.');
  }

  // Cache, not documents: this is a disposable 50MB file that the OS may
  // reclaim, and it should never appear in the user's file browser.
  const destination = new File(Paths.cache, latest.apk);

  // A partial file from an interrupted attempt would install as a corrupt
  // package, so a stale copy is always discarded rather than resumed.
  if (destination.exists) destination.delete();

  const downloaded = await File.downloadFileAsync(APK_URL, destination);

  // Android 7 and later refuse a file:// URI across an app boundary
  // (FileUriExposedException). The installer needs a content:// URI backed by
  // a FileProvider, which is what this produces.
  const contentUri = await getContentUriAsync(downloaded.uri);

  await IntentLauncher.startActivityAsync('android.intent.action.INSTALL_PACKAGE', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    // FLAG_GRANT_READ_URI_PERMISSION — without it the installer cannot read
    // the file it was just handed.
    flags: 1,
  });
}

/** "53.4 MB" — for telling the user what they are about to pull over mobile data. */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return 'unknown size';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}
