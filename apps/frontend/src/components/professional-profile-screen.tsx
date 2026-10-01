import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  ActionButton,
  DetailRow,
  ErrorBlock,
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
import { VerifiedBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { patchAuthSessionUser } from '@/lib/auth-session';

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

type OwnProfile = Awaited<ReturnType<typeof api.professionalProfile.getOwn>>;
type WorkingHour = OwnProfile['workingHours'][number];

/**
 * The professional's own profile.
 *
 * Two fields are deliberately absent: `verification` and `role`. Verification is
 * an admin decision recorded against real evidence, so it is displayed but never
 * editable here.
 */
export function ProfessionalProfileScreen() {
  const router = useRouter();
  const [result, setResult] = useState<{
    request: number;
    data: OwnProfile | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);

  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [bio, setBio] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [yearsOfExperience, setYearsOfExperience] = useState('');
  const [isPhoneVisible, setIsPhoneVisible] = useState(false);
  const [isLocationSharingEnabled, setIsLocationSharingEnabled] = useState(false);
  const [hours, setHours] = useState<WorkingHour[]>([]);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');

  const current = result?.request === reload;
  const profile = current ? result.data : null;
  const failed = current && result.error;

  const load = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.professionalProfile
        .getOwn(controller.signal)
        .then((data) => {
          setResult({ request: reload, data, error: false });
          setFullName(data.fullName);
          setBusinessName(data.businessName);
          setBio(data.bio ?? '');
          setServiceArea(data.serviceArea ?? '');
          setContactEmail(data.contactEmail ?? '');
          setYearsOfExperience(
            data.yearsOfExperience === null ? '' : String(data.yearsOfExperience),
          );
          setIsPhoneVisible(data.isPhoneVisible);
          setIsLocationSharingEnabled(data.isLocationSharingEnabled);
          setHours(data.workingHours);
        })
        .catch(() => {
          if (!controller.signal.aborted) setResult({ request: reload, data: null, error: true });
        });
      return () => controller.abort();
    }, [reload]),
  );

  const save = async () => {
    setSaving(true);
    setFormError('');
    setNotice('');
    try {
      const years = yearsOfExperience.trim() === '' ? null : Number(yearsOfExperience);
      if (years !== null && (!Number.isInteger(years) || years < 0 || years > 80)) {
        throw new Error('Years of experience must be a whole number between 0 and 80.');
      }
      for (const hour of hours) {
        if (
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(hour.start) ||
          !/^([01]\d|2[0-3]):[0-5]\d$/.test(hour.end)
        ) {
          throw new Error(`Working hours for ${DAYS[hour.day]} must use HH:MM.`);
        }
      }
      const updated = await api.professionalProfile.updateOwn({
        fullName,
        businessName,
        bio: bio.trim() === '' ? null : bio.trim(),
        serviceArea: serviceArea.trim() === '' ? null : serviceArea.trim(),
        contactEmail: contactEmail.trim() === '' ? null : contactEmail.trim(),
        yearsOfExperience: years,
        isPhoneVisible,
        isLocationSharingEnabled,
        workingHours: hours,
      });
      // Keep the header's name in step with the saved value straight away; the
      // session is only re-read from the server on the next sign-in. A cleared
      // contact email is left alone here rather than blanking the login email,
      // which the professional may not have set to begin with.
      patchAuthSessionUser({
        fullName: updated.fullName,
        ...(updated.contactEmail ? { email: updated.contactEmail } : {}),
      });
      setNotice('Your profile is saved.');
      load();
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'We couldn’t save your profile.',
      );
    } finally {
      setSaving(false);
    }
  };

  const setHour = (day: number, key: 'start' | 'end', value: string) => {
    setHours((currentHours) => {
      const existing = currentHours.find((hour) => hour.day === day);
      if (!existing) {
        // Enabling a day starts from a real 09:00-18:00 window the professional
        // then edits; nothing is assumed about when they actually work.
        return [
          ...currentHours,
          { day, start: '09:00', end: '18:00', [key]: value } as WorkingHour,
        ];
      }
      return currentHours.map((hour) => (hour.day === day ? { ...hour, [key]: value } : hour));
    });
  };

  const removeDay = (day: number) => {
    setHours((currentHours) => currentHours.filter((hour) => hour.day !== day));
  };

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScreenShell>
        <SectionHeading
          title="My Profile"
          onBack={() => router.replace('/professional')}
          action={
            <Pressable
              accessibilityRole="button"
              onPress={load}
              className="min-h-11 justify-center"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                Refresh
              </Text>
            </Pressable>
          }
        />

        {profile === null && !failed ? (
          <LoadingBlock label="Loading your profile..." />
        ) : failed ? (
          <ErrorBlock onRetry={load} />
        ) : profile ? (
          <>
            <Panel
              title="Verification"
              subtitle="Set by an administrator after reviewing your details."
            >
              {profile.verification === 'VERIFIED' ? (
                <View className="mb-4">
                  <VerifiedBadge />
                </View>
              ) : null}
              <View className="gap-1">
                <DetailRow
                  label="Verification"
                  value={friendlyVerification(profile.verification)}
                />
                <DetailRow
                  label="Verified at"
                  value={
                    profile.verifiedAt
                      ? new Date(profile.verifiedAt).toDateString()
                      : 'Not verified'
                  }
                />
                <DetailRow label="Jobs completed" value={String(profile.completedCount)} />
                <DetailRow
                  label="Average rating"
                  value={
                    profile.ratingCount === 0
                      ? 'No ratings yet'
                      : `${profile.averageRating.toFixed(2)} from ${profile.ratingCount} review${
                          profile.ratingCount === 1 ? '' : 's'
                        }`
                  }
                />
              </View>
              {/*
                A pending decision is stated plainly rather than shown as a
                failure - the professional has done nothing wrong, and the reason
                only exists once an admin has given one.
              */}
              {profile.verification === 'UNVERIFIED' ? (
                <Text className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Your details are with an administrator for review. You can keep editing your
                  profile and services while this is pending.
                </Text>
              ) : null}
              {profile.verification === 'REJECTED' && profile.rejectionNote ? (
                <Text className="mt-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">
                  Reason: {profile.rejectionNote}
                </Text>
              ) : null}
            </Panel>

            <Panel
              title="Business details"
              subtitle="This is what customers see on your marketplace profile."
            >
              <ProfilePhotoEditor
                avatarUrl={profile.avatarUrl}
                displayName={profile.fullName}
                onUpload={api.professionalProfile.uploadPhoto}
                onUploaded={(avatarUrl) => {
                  setResult({
                    request: reload,
                    data: { ...profile, avatarUrl },
                    error: false,
                  });
                  patchAuthSessionUser({ avatarUrl });
                }}
              />
              <LabelledInput label="Your name" value={fullName} onChangeText={setFullName} />
              <LabelledInput
                label="Business name"
                value={businessName}
                onChangeText={setBusinessName}
              />
              <LabelledInput label="Bio" value={bio} onChangeText={setBio} multiline />
              <LabelledInput
                label="Service area"
                value={serviceArea}
                onChangeText={setServiceArea}
                placeholder="Bengaluru"
              />
              <LabelledInput
                label="Contact email (optional)"
                value={contactEmail}
                onChangeText={setContactEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <LabelledInput
                label="Years of experience (optional)"
                value={yearsOfExperience}
                onChangeText={setYearsOfExperience}
                keyboardType="number-pad"
              />
              <LabelledInput
                label="Login phone"
                value={profile.phone}
                onChangeText={() => undefined}
                editable={false}
              />
              <ToggleRow
                label="Show my phone number to customers"
                detail="Your phone is your login. Leave this off to hide it from your public profile."
                value={isPhoneVisible}
                onChange={setIsPhoneVisible}
              />
            </Panel>

            <Panel
              title="Working hours"
              subtitle="Only days you enable here are shown to customers."
            >
              {DAYS.map((day, index) => {
                const hour = hours.find((entry) => entry.day === index);
                return (
                  <View
                    key={day}
                    className="mt-3 rounded-lg border border-hairline p-4 dark:border-hairline-strong"
                  >
                    <View className="flex-row flex-wrap items-center justify-between gap-3">
                      <Text className="font-semibold text-primary">{day}</Text>
                      {hour ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Stop working on ${day}`}
                          onPress={() => removeDay(index)}
                        >
                          <Text className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                            Not working
                          </Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`Work on ${day}`}
                          onPress={() => setHour(index, 'start', '09:00')}
                        >
                          <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                            Working
                          </Text>
                        </Pressable>
                      )}
                    </View>
                    {hour ? (
                      <View className="mt-3 flex-row flex-wrap items-center gap-3">
                        <HourField
                          label="From"
                          value={hour.start}
                          onChange={(next) => setHour(index, 'start', next)}
                        />
                        <HourField
                          label="To"
                          value={hour.end}
                          onChange={(next) => setHour(index, 'end', next)}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </Panel>

            <Panel
              title="Location sharing"
              subtitle="Off by default. You only need it on for jobs you are travelling to or working on."
            >
              <ToggleRow
                label="Share my location with customers during active jobs"
                detail="Customers see the last position your device reported. They never see a live trail."
                value={isLocationSharingEnabled}
                onChange={setIsLocationSharingEnabled}
              />
              {isLocationSharingEnabled ? (
                <LocationReporter />
              ) : (
                <Text className="mt-3 text-sm text-secondary">
                  Sharing is off, so customers are told your location is unavailable rather than
                  being shown a stale position.
                </Text>
              )}
            </Panel>

            <Panel title="Preferences" subtitle="These preferences are stored on this device.">
              <ThemeControl />
            </Panel>

            <ActionButton label="Save profile" onPress={save} busy={saving} />
            <InlineError message={formError} />
            <InlineSuccess message={notice} />
          </>
        ) : null}
      </ScreenShell>
    </RoleScreen>
  );
}

/**
 * Reports a real position for the jobs in progress.
 *
 * This screen has no map or background GPS module, so it will not invent a
 * location. It uses the browser's own geolocation when one exists, and
 * otherwise asks the professional to type coordinates. The API refuses to store
 * anything while sharing is off, and this screen only offers it when on.
 */
function LocationReporter() {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [reporting, setReporting] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const readDevicePosition = async () => {
    setReporting(true);
    setError('');
    setStatus('');
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      setError(
        'This device has no location service available, so enter your coordinates below instead.',
      );
      setReporting(false);
      return;
    }
    geo.getCurrentPosition(
      (position) => {
        // Written into the fields rather than sent straight away, so the
        // professional can see and correct what will be shared.
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setStatus('Position read from this device. Review it, then share.');
        setReporting(false);
      },
      () => {
        setError('This device would not share its position. Enter your coordinates below instead.');
        setReporting(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const share = async () => {
    setReporting(true);
    setError('');
    setStatus('');
    try {
      const lat = Number(latitude);
      const lng = Number(longitude);
      if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
        throw new Error('Latitude must be a number between -90 and 90.');
      }
      if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
        throw new Error('Longitude must be a number between -180 and 180.');
      }
      await api.location.report(lat, lng);
      setStatus('Position shared with customers on your active bookings.');
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : requestError instanceof Error
            ? requestError.message
            : 'We couldn’t share that position.',
      );
    } finally {
      setReporting(false);
    }
  };

  return (
    <View className="mt-4 rounded-lg bg-slate-50 dark:bg-canvas p-4 dark:bg-slate-800/60">
      <Text className="text-sm text-secondary dark:text-primary">
        Share your position only while you are travelling to or working on a job. Turn sharing off
        again afterwards.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Read position from this device"
        accessibilityState={{ busy: reporting }}
        disabled={reporting}
        onPress={readDevicePosition}
        className={`mt-4 min-h-11 flex-row items-center justify-center gap-2 rounded-lg px-4 ${
          reporting
            ? 'bg-surface-sunken dark:bg-slate-700'
            : 'border border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
        }`}
      >
        {reporting ? <ActivityIndicator color="#334155" size="small" /> : null}
        <Text className="font-semibold text-primary">Use this device&apos;s position</Text>
      </Pressable>
      <LabelledInput
        label="Latitude"
        value={latitude}
        onChangeText={setLatitude}
        keyboardType="decimal-pad"
      />
      <LabelledInput
        label="Longitude"
        value={longitude}
        onChangeText={setLongitude}
        keyboardType="decimal-pad"
      />
      <ActionButton
        label="Share this position"
        onPress={share}
        busy={reporting}
        disabled={latitude.trim() === '' || longitude.trim() === ''}
      />
      <InlineError message={error} />
      <InlineSuccess message={status} />
    </View>
  );
}

function HourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View className="min-w-24 flex-1">
      <Text className="text-xs font-semibold uppercase text-muted">{label}</Text>
      <TextInput
        accessibilityLabel={`${label} time`}
        value={value}
        onChangeText={onChange}
        placeholder="09:00"
        placeholderTextColor="#94a3b8"
        className="mt-1 min-h-11 rounded-lg border border-hairline-strong px-3 py-2 text-base text-primary dark:bg-slate-800"
      />
    </View>
  );
}

function ToggleRow({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={label}
      onPress={() => onChange(!value)}
      className="mt-4 min-h-11 flex-row items-start gap-3 rounded-lg border border-hairline p-4 dark:border-hairline-strong"
    >
      <View
        className={`mt-0.5 h-6 w-6 items-center justify-center rounded border ${
          value
            ? 'border-brand-800 bg-brand-800 dark:border-brand-600 dark:bg-brand-600'
            : 'border-slate-400 dark:border-slate-500'
        }`}
      >
        {value ? <Text className="text-sm font-bold text-white">✓</Text> : null}
      </View>
      <View className="flex-1">
        <Text className="text-sm font-semibold text-primary">{label}</Text>
        <Text className="mt-1 text-xs leading-5 text-secondary">{detail}</Text>
      </View>
    </Pressable>
  );
}

function friendlyVerification(status: OwnProfile['verification']) {
  return status
    .toLocaleLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
