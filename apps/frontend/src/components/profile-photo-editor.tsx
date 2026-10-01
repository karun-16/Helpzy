import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

import { api, ApiError } from '@/lib/api';
import { initialsFor } from '@/lib/hooks';

type PhotoUpload = Awaited<ReturnType<typeof api.customerAccount.uploadPhoto>>;
type ProfileImageContentType = 'image/jpeg' | 'image/png' | 'image/webp';
const PROFILE_IMAGE_CONTENT_TYPES: readonly ProfileImageContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

export function ProfilePhotoEditor({
  avatarUrl,
  displayName,
  onUpload,
  onUploaded,
}: {
  avatarUrl: string | null;
  displayName: string;
  onUpload: (base64Data: string, mimeType: ProfileImageContentType) => Promise<PhotoUpload>;
  onUploaded: (avatarUrl: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

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
      const contentType = PROFILE_IMAGE_CONTENT_TYPES.find((type) => type === asset.mimeType);
      if (!contentType) throw new Error('Choose a JPEG, PNG or WebP image.');
      const uploaded = await onUpload(asset.base64, contentType);
      onUploaded(uploaded.publicUrl);
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
      {avatarUrl ? (
        <Image
          source={{ uri: avatarUrl }}
          accessibilityLabel={`${displayName} profile photo`}
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
          JPEG, PNG or WebP. Maximum 5 MB. Stored by the configured media provider.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={avatarUrl ? 'Change profile photo' : 'Add profile photo'}
          accessibilityState={{ busy, disabled: busy }}
          disabled={busy}
          onPress={choosePhoto}
          className={`mt-3 min-h-11 flex-row items-center justify-center gap-2 self-start rounded-lg px-4 ${busy ? 'bg-brand-300 dark:bg-brand-900' : 'bg-brand-800 dark:bg-brand-700'}`}
        >
          {busy ? <ActivityIndicator color="#ffffff" size="small" /> : null}
          <Text className="text-sm font-semibold text-white">
            {busy ? 'Uploading...' : avatarUrl ? 'Change photo' : 'Add photo'}
          </Text>
        </Pressable>
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
