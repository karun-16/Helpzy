import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  ActionButton,
  DetailRow,
  ErrorBlock,
  formatDate,
  InlineError,
  InlineSuccess,
  LabelledInput,
  LoadingBlock,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { AccountSettingsScreen } from '@/components/account-settings-screen';
import { ProfilePhotoEditor } from '@/components/profile-photo-editor';
import { api, ApiError } from '@/lib/api';
import { patchAuthSessionUser } from '@/lib/auth-session';
import type { CustomerProfileDto } from '@helpzy/api-client';

/**
 * The customer's own profile.
 *
 * Phone is the login identity and is deliberately not editable here: the server
 * rejects it, so the field is not offered.
 */
export function CustomerProfileScreen() {
  const router = useRouter();

  const [profileResult, setProfileResult] = useState<{
    request: number;
    data: CustomerProfileDto | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const profileCurrent = profileResult?.request === reload;
  const profile = profileCurrent ? profileResult.data : null;
  const profileFailed = profileCurrent && profileResult.error;

  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.customerAccount
        .getProfile(controller.signal)
        .then((data) => {
          setProfileResult({ request: reload, data, error: false });
          setFullName(data.fullName);
          setEmail(data.email ?? '');
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setProfileResult({ request: reload, data: null, error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileError('');
    setProfileSuccess('');
    try {
      // An empty email field means "no email", which is sent explicitly rather
      // than skipped, so clearing the field actually clears the record.
      const updated = await api.customerAccount.updateProfile({
        fullName,
        email: email.trim() === '' ? null : email.trim(),
      });
      setProfileResult({ request: reload, data: updated, error: false });
      setFullName(updated.fullName);
      setEmail(updated.email ?? '');
      // The server confirmed the change, so the header's name and welcome text
      // are updated now instead of waiting for a re-login.
      patchAuthSessionUser({ fullName: updated.fullName, email: updated.email ?? undefined });
      setProfileSuccess('Your profile is saved.');
    } catch (requestError) {
      setProfileError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t save your profile. Please try again.',
      );
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <RoleScreen role="CUSTOMER" homeRoute="/customer" onHome={() => router.replace('/customer')}>
      <ScreenShell>
        <SectionHeading title="My Profile" onBack={() => router.replace('/customer')} />

        <Panel
          title="Your profile"
          subtitle="Your phone number is your login and cannot be changed here."
        >
          {profile === null && !profileFailed ? (
            <LoadingBlock label="Loading your profile..." />
          ) : profileFailed ? (
            <ErrorBlock onRetry={load} />
          ) : profile ? (
            <View>
              <ProfilePhotoEditor
                avatarUrl={profile.avatarUrl}
                displayName={profile.fullName}
                onUpload={api.customerAccount.uploadPhoto}
                onUploaded={async () => {
                  const refreshed = await api.customerAccount.getProfile();
                  setProfileResult({
                    request: reload,
                    data: refreshed,
                    error: false,
                  });
                  patchAuthSessionUser({
                    avatarUrl: refreshed.avatarUrl,
                    fullName: refreshed.fullName,
                    email: refreshed.email ?? undefined,
                  });
                }}
              />
              <View className="gap-1">
                <DetailRow label="Phone" value={profile.phone} />
                <DetailRow label="Role" value={profile.role} />
                <DetailRow label="Status" value={profile.status} />
                <DetailRow label="Member since" value={formatDate(profile.memberSince)} />
                <DetailRow label="Bookings" value={String(profile.bookingCount)} />
                <DetailRow label="Saved addresses" value={String(profile.addressCount)} />
                <DetailRow
                  label="Avatar"
                  value={profile.avatarUrl ? 'Uploaded' : 'No photo uploaded'}
                />
              </View>
              <LabelledInput label="Full name" value={fullName} onChangeText={setFullName} />
              <LabelledInput
                label="Email (optional)"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="you@example.com"
              />
              <ActionButton
                label="Save profile"
                onPress={saveProfile}
                busy={savingProfile}
                disabled={fullName.trim().length < 2}
              />
              <InlineError message={profileError} />
              <InlineSuccess message={profileSuccess} />
            </View>
          ) : null}
        </Panel>
      </ScreenShell>
    </RoleScreen>
  );
}

export function CustomerSettingsScreen() {
  return <AccountSettingsScreen role="CUSTOMER" />;
}
