import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  HEIC_IMAGE_CONTENT_TYPES,
  PROFILE_IMAGE_CONTENT_TYPES,
  PROFILE_IMAGE_FORMAT_SUMMARY,
  type ProfileImageContentType,
} from '@helpzy/validation';

import { api, ApiError } from '@/lib/api';
import { appConfig, resolveMediaUrl } from '@/lib/config';
import { initialsFor, useLoadableImage } from '@/lib/hooks';

type PhotoUpload = Awaited<ReturnType<typeof api.customerAccount.uploadPhoto>>;
const MAX_PROFILE_IMAGE_BYTES = appConfig.mediaMaxBytes;

/**
 * Normalises what a browser reports for a chosen file.
 *
 * `expo-image-picker` hands back `File.type` on web, and the wild in that is not
 * small: Windows still produces `image/jpg` for a plain JPEG, and some pickers
 * report nothing at all. Rejecting a real JPEG over a spelling difference is how
 * "choose a JPEG" became "some photos are refused", so the two historical
 * spellings are mapped onto the canonical one before anything is refused.
 */
function normaliseContentType(mimeType: string | undefined): string | null {
  const value = (mimeType ?? '').trim().toLowerCase();
  if (value === 'image/jpg' || value === 'image/pjpeg') return 'image/jpeg';
  if (value === 'image/x-png') return 'image/png';
  return value || null;
}

interface PendingPhoto {
  data: string;
  contentType: ProfileImageContentType;
  previewUri: string;
}

export function ProfilePhotoEditor({
  avatarUrl,
  displayName,
  onUpload,
  onUploaded,
}: {
  avatarUrl: string | null;
  displayName: string;
  onUpload: (base64Data: string, mimeType: ProfileImageContentType) => Promise<PhotoUpload>;
  onUploaded: (avatarUrl: string) => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const previewUrl = pendingPhoto?.previewUri ?? avatarUrl;
  const resolvedPreviewUrl = previewUrl ? resolveMediaUrl(previewUrl) : null;
  const photo = useLoadableImage(resolvedPreviewUrl);

  const choosePhoto = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const selection = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.82,
        base64: true,
      });
      if (selection.canceled) return;
      const asset = selection.assets[0];
      if (!asset?.base64) throw new Error('The selected image could not be read.');
      const declared = normaliseContentType(asset.mimeType);
      /*
       * Named rather than lumped in with "unsupported". A HEIC file is what a
       * phone hands over by default, and "unsupported image" would read as a
       * broken app rather than as a file that needs exporting.
       */
      if (declared && (HEIC_IMAGE_CONTENT_TYPES as readonly string[]).includes(declared)) {
        throw new Error(
          'HEIC photos cannot be displayed in a browser. Please export the photo as JPEG and upload it again.',
        );
      }
      const contentType = PROFILE_IMAGE_CONTENT_TYPES.find((type) => type === declared);
      if (!contentType) throw new Error(`Choose a ${PROFILE_IMAGE_FORMAT_SUMMARY} image.`);
      const base64Padding = asset.base64.length - asset.base64.replace(/=+$/, '').length;
      const decodedSize = Math.floor((asset.base64.length * 3) / 4) - base64Padding;
      if (
        (asset.fileSize !== undefined && asset.fileSize > MAX_PROFILE_IMAGE_BYTES) ||
        decodedSize > MAX_PROFILE_IMAGE_BYTES
      ) {
        throw new Error(
          `Choose an image smaller than ${Math.ceil(MAX_PROFILE_IMAGE_BYTES / (1024 * 1024))} MB.`,
        );
      }
      setPendingPhoto({
        data: asset.base64,
        contentType,
        previewUri: `data:${contentType};base64,${asset.base64}`,
      });
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError
          ? uploadError.message
          : uploadError instanceof Error
            ? uploadError.message
            : 'We couldn’t read that photo. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const savePhoto = async () => {
    if (!pendingPhoto || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const uploaded = await onUpload(pendingPhoto.data, pendingPhoto.contentType);
      await onUploaded(uploaded.publicUrl);
      setPendingPhoto(null);
      setNotice('Profile photo updated.');
    } catch (uploadError) {
      setError(
        uploadError instanceof ApiError
          ? uploadError.message
          : uploadError instanceof Error
            ? uploadError.message
            : 'We couldn’t upload that photo. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const initials = initialsFor(displayName);

  return (
    <View className="mt-4 flex-row flex-wrap items-center gap-4 rounded-lg border border-hairline bg-slate-50 dark:bg-canvas p-4 dark:border-hairline-strong dark:bg-slate-800/60">
      {photo.uri ? (
        <Image
          key={photo.attemptKey}
          source={{ uri: photo.uri }}
          accessibilityLabel={`${displayName} profile photo`}
          onError={photo.onError}
          className="h-20 w-20 rounded-full bg-surface-sunken dark:bg-slate-700"
        />
      ) : (
        <View
          accessibilityLabel="No profile photo"
          className="h-20 w-20 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-950 dark:bg-brand-900"
        >
          <Text className="text-xl font-bold text-brand-900 dark:text-brand-200 dark:text-brand-100">
            {initials || '?'}
          </Text>
        </View>
      )}
      <View className="min-w-48 flex-1">
        <Text className="text-sm font-semibold text-primary">Profile photo</Text>
        <Text className="mt-1 text-xs leading-5 text-secondary">
          {PROFILE_IMAGE_FORMAT_SUMMARY}. Maximum{' '}
          {Math.ceil(MAX_PROFILE_IMAGE_BYTES / (1024 * 1024))} MB. Stored by the configured media
          provider.
        </Text>
        {/*
         * Said out loud rather than left as a silent fallback. A photo that saved
         * but will not display is indistinguishable from one that never saved
         * unless the screen admits it, and that ambiguity is the whole complaint.
         */}
        {!photo.uri && resolvedPreviewUrl && !pendingPhoto ? (
          <Text
            accessibilityRole="alert"
            className="mt-2 rounded-lg bg-warning-soft px-3 py-2 text-xs text-primary"
          >
            Your photo is saved, but this browser could not display it. Choosing it again will
            replace it.
          </Text>
        ) : null}
        <View className="mt-3 flex-row flex-wrap gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              pendingPhoto ? 'Choose another profile photo' : 'Choose profile photo'
            }
            accessibilityState={{ busy, disabled: busy }}
            disabled={busy}
            onPress={() => void choosePhoto()}
            className={`min-h-11 flex-row items-center justify-center gap-2 rounded-lg px-4 ${busy ? 'bg-brand-300 dark:bg-brand-900' : 'bg-brand-800 dark:bg-brand-700'}`}
          >
            {busy && !pendingPhoto ? <ActivityIndicator color="#ffffff" size="small" /> : null}
            <Text className="text-sm font-semibold text-white">
              {busy && !pendingPhoto
                ? 'Choosing...'
                : pendingPhoto
                  ? 'Choose another'
                  : 'Choose photo'}
            </Text>
          </Pressable>
          {pendingPhoto ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save profile photo"
                accessibilityState={{ busy, disabled: busy }}
                disabled={busy}
                onPress={() => void savePhoto()}
                className="min-h-11 flex-row items-center justify-center gap-2 rounded-lg bg-brand-700 px-4"
              >
                {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
                <Text className="text-sm font-semibold text-white">
                  {busy ? 'Uploading...' : 'Save photo'}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Discard selected photo"
                disabled={busy}
                onPress={() => {
                  setPendingPhoto(null);
                  setError('');
                  setNotice('');
                }}
                className="min-h-11 justify-center rounded-lg border border-hairline-strong px-4"
              >
                <Text className="text-sm font-semibold text-secondary dark:text-primary">
                  Cancel
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        {error ? (
          <Text accessibilityRole="alert" className="mt-2 text-sm text-rose-800 dark:text-rose-300">
            {error}
          </Text>
        ) : null}
        {notice ? (
          <Text className="mt-2 text-sm font-medium text-brand-800 dark:text-brand-300">
            {notice}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
