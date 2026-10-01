import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
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
  ThemeControl,
} from '@/components/marketplace-ui';
import { ProfilePhotoEditor } from '@/components/profile-photo-editor';
import { api, ApiError } from '@/lib/api';
import { clearAuthSession, patchAuthSessionUser } from '@/lib/auth-session';
import { resetUnreadCount } from '@/lib/notifications';
import type { CustomerAddressDto, CustomerProfileDto } from '@helpzy/api-client';

const ADDRESS_TYPES = ['HOME', 'WORK', 'OTHER'] as const;

type AddressType = (typeof ADDRESS_TYPES)[number];

const EMPTY_ADDRESS = {
  label: '',
  type: 'HOME' as AddressType,
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  isDefault: false,
};

/**
 * The customer's own profile and address book.
 *
 * Phone is the login identity and is deliberately not editable here: the server
 * rejects it, so the field is not offered.
 */
export function CustomerSettingsScreen() {
  const router = useRouter();

  const [profileResult, setProfileResult] = useState<{
    request: number;
    data: CustomerProfileDto | null;
    error: boolean;
  } | null>(null);
  const [addressesResult, setAddressesResult] = useState<{
    request: number;
    data: CustomerAddressDto[];
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [draft, setDraft] = useState(EMPTY_ADDRESS);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addressError, setAddressError] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const profileCurrent = profileResult?.request === reload;
  const addressesCurrent = addressesResult?.request === reload;
  const profile = profileCurrent ? profileResult.data : null;
  const loadedAddresses = addressesCurrent ? addressesResult.data : null;
  const addresses = loadedAddresses ?? [];
  const profileFailed = profileCurrent && profileResult.error;
  const addressesFailed = addressesCurrent && addressesResult.error;

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
      api.customerAccount
        .listAddresses(controller.signal)
        .then((data) => setAddressesResult({ request: reload, data, error: false }))
        .catch(() => {
          if (!controller.signal.aborted) {
            setAddressesResult({ request: reload, data: [], error: true });
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

  const saveAddress = async () => {
    setSavingAddress(true);
    setAddressError('');
    try {
      const payload = {
        label: draft.label.trim(),
        type: draft.type,
        line1: draft.line1.trim(),
        ...(draft.line2.trim() ? { line2: draft.line2.trim() } : {}),
        city: draft.city.trim(),
        state: draft.state.trim(),
        postalCode: draft.postalCode.trim(),
        isDefault: draft.isDefault,
      };
      if (editingAddressId) {
        await api.customerAccount.updateAddress(editingAddressId, payload);
      } else {
        await api.customerAccount.createAddress(payload);
      }
      setDraft(EMPTY_ADDRESS);
      setEditingAddressId(null);
      load();
    } catch (requestError) {
      setAddressError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t save that address. Please check the fields and try again.',
      );
    } finally {
      setSavingAddress(false);
    }
  };

  const setDefault = async (addressId: string) => {
    setAddressError('');
    try {
      await api.customerAccount.setDefaultAddress(addressId);
      load();
    } catch (requestError) {
      setAddressError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t update that address.',
      );
    }
  };

  const removeAddress = async (addressId: string) => {
    setAddressError('');
    try {
      await api.customerAccount.deleteAddress(addressId);
      load();
    } catch (requestError) {
      setAddressError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t delete that address.',
      );
    }
  };

  const startEditing = (address: CustomerAddressDto) => {
    setEditingAddressId(address.id);
    setAddressError('');
    setDraft({
      label: address.label,
      type: address.type,
      line1: address.line1,
      line2: address.line2 ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    });
  };

  const logout = () => {
    // The unread badge is per user and must not leak into the next sign-in.
    resetUnreadCount();
    clearAuthSession();
    router.replace('/');
  };

  return (
    <RoleScreen role="CUSTOMER" homeRoute="/customer" onHome={() => router.replace('/customer')}>
      <ScreenShell>
        <SectionHeading title="Settings" onBack={() => router.replace('/customer')} />

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
                onUploaded={(avatarUrl) => {
                  setProfileResult({
                    request: reload,
                    data: { ...profile, avatarUrl },
                    error: false,
                  });
                  // Patching the session here is what makes the header avatar
                  // change the moment the upload succeeds.
                  patchAuthSessionUser({ avatarUrl });
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

        <Panel
          title="Saved addresses"
          subtitle="Addresses are stored on your account and reused when you book a service."
        >
          {loadedAddresses === null && !addressesFailed ? (
            <LoadingBlock label="Loading your addresses..." />
          ) : addressesFailed ? (
            <ErrorBlock onRetry={load} />
          ) : addresses.length === 0 ? (
            <Text className="text-sm text-secondary">
              You haven&apos;t saved an address yet. Add one below.
            </Text>
          ) : (
            <View className="gap-3">
              {addresses.map((address) => (
                <View
                  key={address.id}
                  className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong dark:bg-slate-800/60"
                >
                  <View className="flex-row flex-wrap items-center justify-between gap-2">
                    <Text className="font-semibold text-primary">{address.label}</Text>
                    <View className="flex-row gap-2">
                      {address.isDefault ? (
                        <View className="rounded-full bg-brand-100 px-2.5 py-0.5 dark:bg-brand-950">
                          <Text className="text-xs font-bold uppercase text-brand-800 dark:text-brand-300">
                            Default
                          </Text>
                        </View>
                      ) : null}
                      <View className="rounded-full bg-surface-muted px-2.5 py-0.5 dark:bg-slate-800">
                        <Text className="text-xs font-bold uppercase text-secondary dark:text-primary">
                          {address.type}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <Text className="mt-1 text-sm leading-5 text-secondary dark:text-primary">
                    {[
                      address.line1,
                      address.line2,
                      `${address.city}, ${address.state} ${address.postalCode}`,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </Text>
                  <View className="mt-3 flex-row flex-wrap gap-4">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${address.label}`}
                      onPress={() => startEditing(address)}
                    >
                      <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                        Edit
                      </Text>
                    </Pressable>
                    {!address.isDefault ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Make ${address.label} the default address`}
                        onPress={() => setDefault(address.id)}
                      >
                        <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                          Make default
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${address.label}`}
                      onPress={() => removeAddress(address.id)}
                    >
                      <Text className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View className="mt-6 border-t border-hairline pt-5 dark:border-hairline-strong">
            <Text className="text-sm font-semibold text-primary">
              {editingAddressId ? 'Edit address' : 'Add an address'}
            </Text>
            <LabelledInput
              label="Label"
              value={draft.label}
              onChangeText={(next) => setDraft({ ...draft, label: next })}
              placeholder="Home, Office..."
            />
            <View className="mt-4 flex-row flex-wrap gap-2">
              {ADDRESS_TYPES.map((type) => (
                <Pressable
                  key={type}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: draft.type === type }}
                  onPress={() => setDraft({ ...draft, type })}
                  className={`min-h-11 justify-center rounded-lg px-4 ${
                    draft.type === type
                      ? 'bg-brand-800 dark:bg-brand-700'
                      : 'border border-hairline-strong dark:border-hairline-strong'
                  }`}
                >
                  <Text
                    className={`text-sm font-semibold ${
                      draft.type === type ? 'text-white' : 'text-secondary dark:text-primary'
                    }`}
                  >
                    {type}
                  </Text>
                </Pressable>
              ))}
            </View>
            <LabelledInput
              label="Address line 1"
              value={draft.line1}
              onChangeText={(next) => setDraft({ ...draft, line1: next })}
            />
            <LabelledInput
              label="Address line 2 (optional)"
              value={draft.line2}
              onChangeText={(next) => setDraft({ ...draft, line2: next })}
            />
            <LabelledInput
              label="City"
              value={draft.city}
              onChangeText={(next) => setDraft({ ...draft, city: next })}
            />
            <LabelledInput
              label="State"
              value={draft.state}
              onChangeText={(next) => setDraft({ ...draft, state: next })}
            />
            <LabelledInput
              label="Postal code"
              value={draft.postalCode}
              onChangeText={(next) => setDraft({ ...draft, postalCode: next })}
              autoCapitalize="characters"
            />
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.isDefault }}
              onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })}
              className="mt-4 min-h-11 flex-row items-center gap-3"
            >
              <View
                className={`h-6 w-6 items-center justify-center rounded border ${
                  draft.isDefault
                    ? 'border-brand-800 bg-brand-800 dark:border-brand-600 dark:bg-brand-600'
                    : 'border-slate-400 dark:border-slate-500'
                }`}
              >
                {draft.isDefault ? <Text className="text-sm font-bold text-white">✓</Text> : null}
              </View>
              <Text className="text-sm font-medium text-primary">Use as my default address</Text>
            </Pressable>
            <ActionButton
              label={editingAddressId ? 'Save address' : 'Add address'}
              onPress={saveAddress}
              busy={savingAddress}
              disabled={
                draft.label.trim().length === 0 ||
                draft.line1.trim().length < 3 ||
                draft.city.trim().length < 2 ||
                draft.state.trim().length < 2 ||
                draft.postalCode.trim().length < 3
              }
            />
            {editingAddressId ? (
              <ActionButton
                label="Cancel editing"
                tone="subtle"
                onPress={() => {
                  setDraft(EMPTY_ADDRESS);
                  setEditingAddressId(null);
                }}
              />
            ) : null}
            <InlineError message={addressError} />
          </View>
        </Panel>

        <Panel title="Preferences" subtitle="These preferences are stored on this device.">
          <ThemeControl />
          <View className="mt-5 border-t border-hairline pt-4 dark:border-hairline-strong">
            <Text className="text-sm font-semibold text-primary">Notifications</Text>
            <Text className="mt-1 text-sm leading-5 text-secondary">
              Booking and account updates are available in your in-app inbox. Push delivery is not
              configured.
            </Text>
            <ActionButton
              label="View notifications"
              tone="subtle"
              onPress={() => router.push('/customer/notifications')}
            />
          </View>
        </Panel>

        <Panel title="Security" subtitle="Your phone number remains tied to your sign-in identity.">
          <DetailRow label="Sign-in phone" value={profile?.phone ?? 'Load your account to view'} />
          <Text className="mt-3 text-sm leading-5 text-secondary">
            Phone changes are not available from profile settings.
          </Text>
          <ActionButton label="Log out" tone="subtle" onPress={logout} />
        </Panel>

        <Panel title="About">
          <Text className="text-sm font-semibold text-primary">Help</Text>
          <Text className="mt-1 text-sm leading-5 text-secondary">
            For help with a service, open that booking and message its assigned professional.
          </Text>
          <ActionButton
            label="Open My Bookings"
            tone="subtle"
            onPress={() => router.push('/customer/bookings')}
          />
          <View className="mt-4 gap-2 border-t border-hairline pt-4 dark:border-hairline-strong">
            <DetailRow label="Terms" value="Policy text is not configured in this build." />
            <DetailRow label="Privacy" value="Policy text is not configured in this build." />
          </View>
        </Panel>
      </ScreenShell>
    </RoleScreen>
  );
}
