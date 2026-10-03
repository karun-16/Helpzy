import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { CustomerAddressDto } from '@helpzy/api-client';

import { AuthenticatedRoleScreen } from '@/components/authenticated-role-screen';
import { CustomerMarketplaceHeader } from '@/components/customer-marketplace-header';
import { DatePickerField, parseDisplayDate } from '@/components/date-picker-field';
import { parseDisplayTime, TimePickerField, to24Hour } from '@/components/time-picker-field';
import { api, ApiError } from '@/lib/api';
import { clearAuthSession, writePendingAuthRedirect } from '@/lib/auth-session';
import { useAuthSession } from '@/lib/hooks';

type ProfessionalProfile = Awaited<ReturnType<typeof api.customerDiscovery.getProfessionalProfile>>;
type CreatedBooking = Awaited<ReturnType<typeof api.customerBookings.create>>;

/**
 * Combines the two typed fields into the instant the API stores.
 *
 * The 12-hour value is converted here, in one place, so the dial and manual
 * typing produce the same instant. A past local time returns null rather than a
 * corrected value, so an invalid choice blocks submission instead of silently
 * booking a different moment.
 */
function parseFutureLocalDateTime(dateText: string, timeText: string): Date | null {
  const date = parseDisplayDate(dateText);
  const time = parseDisplayTime(timeText);
  if (!date || !time) return null;

  const value = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    to24Hour(time.hour, time.period),
    time.minute,
  );
  if (
    value.getFullYear() !== date.getFullYear() ||
    value.getMonth() !== date.getMonth() ||
    value.getDate() !== date.getDate() ||
    value.getHours() !== to24Hour(time.hour, time.period) ||
    value.getMinutes() !== time.minute ||
    value.getTime() <= Date.now()
  ) {
    return null;
  }
  return value;
}

function formatSchedule(value: string) {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(date),
    time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date),
  };
}

export function CustomerBookingFormScreen() {
  const router = useRouter();
  const { professionalId, serviceId } = useLocalSearchParams<{
    professionalId: string;
    serviceId: string;
  }>();
  const session = useAuthSession();
  const [profileResult, setProfileResult] = useState<{
    key: string;
    data: ProfessionalProfile | null;
    error: boolean;
  } | null>(null);
  const [retry, setRetry] = useState(0);
  const [dateText, setDateText] = useState('');
  const [timeText, setTimeText] = useState('');
  const [addressesResult, setAddressesResult] = useState<{
    data: CustomerAddressDto[];
    error: boolean;
  } | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [manualAddress, setManualAddress] = useState(false);
  const [requirement, setRequirement] = useState('');
  const [label, setLabel] = useState('Home');
  const [addressType, setAddressType] = useState<'HOME' | 'WORK' | 'OTHER'>('HOME');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [booking, setBooking] = useState<CreatedBooking | null>(null);
  const requestKey = `${professionalId ?? ''}:${serviceId ?? ''}:${retry}`;
  const profile = profileResult?.key === requestKey ? profileResult.data : null;
  const loading = Boolean(professionalId && serviceId) && profileResult?.key !== requestKey;
  const loadError =
    !professionalId || !serviceId || (profileResult?.key === requestKey && profileResult.error);

  useEffect(() => {
    if (!session && professionalId && serviceId) {
      writePendingAuthRedirect(
        `/customer/bookings/new?professionalId=${encodeURIComponent(professionalId)}&serviceId=${encodeURIComponent(serviceId)}`,
      );
    }
  }, [professionalId, serviceId, session]);

  useEffect(() => {
    if (!professionalId || !serviceId) return;
    const controller = new AbortController();
    api.customerDiscovery
      .getProfessionalProfile(professionalId, controller.signal)
      .then((data) => setProfileResult({ key: requestKey, data, error: false }))
      .catch(() => {
        if (!controller.signal.aborted) {
          setProfileResult({ key: requestKey, data: null, error: true });
        }
      });
    return () => controller.abort();
  }, [professionalId, requestKey, serviceId]);

  useEffect(() => {
    const controller = new AbortController();
    api.customerAccount
      .listAddresses(controller.signal)
      .then((addresses) => {
        setAddressesResult({ data: addresses, error: false });
        setSelectedAddressId(
          (current) =>
            current ??
            addresses.find((address) => address.isDefault)?.id ??
            addresses[0]?.id ??
            null,
        );
        if (addresses.length === 0) setManualAddress(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setAddressesResult({ data: [], error: true });
          setManualAddress(true);
        }
      });
    return () => controller.abort();
  }, []);

  const service = profile?.services.find((item) => item.id === serviceId);
  const scheduledStart = parseFutureLocalDateTime(dateText, timeText);
  const selectedAddress = addressesResult?.data.find((address) => address.id === selectedAddressId);
  const hasSavedAddress = !manualAddress && Boolean(selectedAddress);
  const addressValid =
    hasSavedAddress ||
    (manualAddress &&
      label.trim().length > 0 &&
      line1.trim().length >= 3 &&
      city.trim().length >= 2 &&
      state.trim().length >= 2 &&
      postalCode.trim().length >= 3);
  const formValid = Boolean(scheduledStart && addressValid && profile && service);

  const logout = () => {
    clearAuthSession();
    router.replace('/');
  };

  const submit = async () => {
    if (!scheduledStart || !profile || !service || !formValid) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const created = await api.customerBookings.create({
        professionalId: profile.id,
        serviceId: service.id,
        scheduledStart: scheduledStart.toISOString(),
        requirement: requirement.trim() || undefined,
        ...(hasSavedAddress && selectedAddress
          ? { addressId: selectedAddress.id }
          : {
              address: {
                label: label.trim(),
                type: addressType,
                line1: line1.trim(),
                line2: line2.trim() || undefined,
                city: city.trim(),
                state: state.trim(),
                postalCode: postalCode.trim(),
              },
            }),
      });
      setBooking(created);
    } catch (error) {
      setSubmitError(
        error instanceof ApiError
          ? error.message
          : 'We could not send your request. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthenticatedRoleScreen role="CUSTOMER">
      <View className="flex-1 bg-slate-50 dark:bg-canvas">
        <CustomerMarketplaceHeader
          customerName={session?.user.fullName ?? 'Customer'}
          onHomePress={() => router.replace('/customer')}
          onLogout={logout}
        />
        <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
          <View className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
            <Pressable
              accessibilityRole="button"
              onPress={() => router.back()}
              className="mb-5 self-start"
            >
              <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                ← Back to profile
              </Text>
            </Pressable>
            {booking ? (
              <BookingConfirmation
                booking={booking}
                onBookings={() => router.replace('/customer/bookings')}
                onHome={() => router.replace('/customer')}
              />
            ) : loading ? (
              <View className="min-h-40 flex-row items-center justify-center gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface">
                <ActivityIndicator color="#047857" />
                <Text className="text-sm text-secondary">Loading selected service...</Text>
              </View>
            ) : loadError || !profile || !service ? (
              <View className="rounded-xl border border-rose-200 dark:border-rose-900 bg-surface p-6">
                <Text className="text-base font-semibold text-primary">
                  This service is no longer available.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setRetry((value) => value + 1)}
                  className="mt-3 self-start"
                >
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    Try again
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.back()}
                  className="mt-4 self-start"
                >
                  <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                    Return to profile
                  </Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Text className="text-3xl font-black text-primary">Request a booking</Text>
                <Text className="mt-2 text-base text-secondary">
                  Choose a time and tell the professional where to meet you.
                </Text>

                <View className="mt-7 gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5">
                  <Text className="text-lg font-bold text-primary">Your service</Text>
                  <ReadOnlyValue label="Service" value={service.title} />
                  <ReadOnlyValue
                    label="Professional"
                    value={`${profile.businessName} · ${profile.fullName}`}
                  />
                  <Text className="text-sm font-medium text-secondary">
                    Price will be confirmed by the professional.
                  </Text>
                </View>

                <View className="mt-6 gap-4 rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5">
                  <Text className="text-lg font-bold text-primary">When works for you?</Text>
                  <BookingField label="Date" hint="DD/MM/YYYY">
                    <DatePickerField value={dateText} onChange={setDateText} />
                  </BookingField>
                  <BookingField label="Time" hint="12-hour, AM/PM">
                    <TimePickerField value={timeText} onChange={setTimeText} />
                  </BookingField>
                  {(dateText || timeText) && !scheduledStart ? (
                    <Text
                      accessibilityRole="alert"
                      className="text-sm text-rose-700 dark:text-rose-300"
                    >
                      Choose a valid future date and time.
                    </Text>
                  ) : null}
                </View>

                <View className="mt-6 gap-4 rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5">
                  <Text className="text-lg font-bold text-primary">Service location</Text>
                  {addressesResult === null ? (
                    <View className="min-h-12 flex-row items-center gap-2">
                      <ActivityIndicator color="#047857" />
                      <Text className="text-sm text-secondary">Loading saved addresses...</Text>
                    </View>
                  ) : null}
                  {addressesResult?.error ? (
                    <Text className="text-sm text-amber-800">
                      Saved addresses could not be loaded. You can still enter a location below.
                    </Text>
                  ) : null}
                  {addressesResult && addressesResult.data.length > 0 && !manualAddress ? (
                    <View className="gap-2">
                      <Text className="text-sm text-secondary">Choose a saved address</Text>
                      {addressesResult.data.map((address) => (
                        <Pressable
                          key={address.id}
                          accessibilityRole="radio"
                          accessibilityState={{ selected: selectedAddressId === address.id }}
                          onPress={() => setSelectedAddressId(address.id)}
                          className={`rounded-lg border p-4 ${selectedAddressId === address.id ? 'border-brand-700 bg-brand-50' : 'border-hairline dark:border-hairline-strong bg-surface'}`}
                        >
                          <Text className="font-semibold text-primary">
                            {address.label}
                            {address.isDefault ? ' · Default' : ''}
                          </Text>
                          <Text className="mt-1 text-sm leading-5 text-secondary">
                            {[
                              address.line1,
                              address.line2,
                              `${address.city}, ${address.state} ${address.postalCode}`,
                            ]
                              .filter(Boolean)
                              .join(', ')}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setManualAddress(true)}
                        className="min-h-11 self-start justify-center"
                      >
                        <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                          Use another address
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                  {manualAddress ? (
                    <>
                      {addressesResult?.data.length ? (
                        <Pressable
                          accessibilityRole="button"
                          onPress={() => setManualAddress(false)}
                          className="min-h-10 self-start justify-center"
                        >
                          <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                            Choose a saved address
                          </Text>
                        </Pressable>
                      ) : null}
                      <View className="flex-row flex-wrap gap-2">
                        {(['HOME', 'WORK', 'OTHER'] as const).map((type) => (
                          <Pressable
                            key={type}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: addressType === type }}
                            onPress={() => {
                              setAddressType(type);
                              if (type !== 'OTHER') setLabel(type === 'HOME' ? 'Home' : 'Work');
                            }}
                            className={`min-h-10 justify-center rounded-lg px-3 ${addressType === type ? 'bg-brand-800' : 'border border-hairline-strong dark:border-hairline-strong bg-surface'}`}
                          >
                            <Text
                              className={`text-sm font-semibold ${addressType === type ? 'text-white' : 'text-secondary dark:text-primary'}`}
                            >
                              {type === 'OTHER'
                                ? 'Other'
                                : type.charAt(0) + type.slice(1).toLowerCase()}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <BookingField label="Address label">
                        <TextInput
                          accessibilityLabel="Address label"
                          value={label}
                          onChangeText={setLabel}
                          className={inputClass}
                        />
                      </BookingField>
                      <BookingField label="Address line 1">
                        <TextInput
                          accessibilityLabel="Address line 1"
                          value={line1}
                          onChangeText={setLine1}
                          placeholder="Street address"
                          className={inputClass}
                        />
                      </BookingField>
                      <BookingField label="Address line 2" hint="Optional">
                        <TextInput
                          accessibilityLabel="Address line 2"
                          value={line2}
                          onChangeText={setLine2}
                          placeholder="Apartment, floor, landmark"
                          className={inputClass}
                        />
                      </BookingField>
                      <View className="flex-row flex-wrap gap-3">
                        <View className="min-w-48 flex-1">
                          <BookingField label="City">
                            <TextInput
                              accessibilityLabel="City"
                              value={city}
                              onChangeText={setCity}
                              className={inputClass}
                            />
                          </BookingField>
                        </View>
                        <View className="min-w-48 flex-1">
                          <BookingField label="State">
                            <TextInput
                              accessibilityLabel="State"
                              value={state}
                              onChangeText={setState}
                              className={inputClass}
                            />
                          </BookingField>
                        </View>
                        <View className="min-w-36 flex-1">
                          <BookingField label="Postal code">
                            <TextInput
                              accessibilityLabel="Postal code"
                              value={postalCode}
                              onChangeText={setPostalCode}
                              className={inputClass}
                            />
                          </BookingField>
                        </View>
                      </View>
                    </>
                  ) : null}
                </View>

                <View className="mt-6 gap-3 rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5">
                  <BookingField label="Requirement / description" hint="Optional">
                    <TextInput
                      accessibilityLabel="Requirement or description"
                      value={requirement}
                      onChangeText={setRequirement}
                      multiline
                      textAlignVertical="top"
                      placeholder="Share anything the professional should know."
                      className="min-h-28 rounded-lg border border-hairline-strong px-3 py-3 text-base text-primary"
                    />
                  </BookingField>
                </View>

                {submitError ? (
                  <Text
                    accessibilityRole="alert"
                    className="mt-4 rounded-lg bg-rose-50 dark:bg-rose-950/40 px-4 py-3 text-sm text-rose-800 dark:text-rose-300"
                  >
                    {submitError}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: !formValid || submitting, busy: submitting }}
                  disabled={!formValid || submitting}
                  onPress={submit}
                  className={`mt-6 min-h-12 flex-row items-center justify-center gap-2 rounded-lg px-5 ${formValid && !submitting ? 'bg-brand-800' : 'bg-slate-300 dark:bg-slate-700'}`}
                >
                  {submitting ? <ActivityIndicator color="#ffffff" /> : null}
                  <Text
                    className={`text-base font-semibold ${formValid && !submitting ? 'text-white' : 'text-secondary dark:text-secondary'}`}
                  >
                    {submitting ? 'Sending request...' : 'Confirm Booking'}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </View>
    </AuthenticatedRoleScreen>
  );
}

const inputClass =
  'min-h-12 rounded-lg border border-hairline-strong dark:border-hairline-strong px-3 text-base text-primary dark:text-primary';

function ReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <Text className="text-xs font-semibold uppercase text-muted">{label}</Text>
      <Text className="mt-1 text-base font-medium text-primary">{value}</Text>
    </View>
  );
}

function BookingField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-1.5">
      <View className="flex-row items-baseline gap-2">
        <Text className="text-sm font-semibold text-primary">{label}</Text>
        {hint ? <Text className="text-xs text-muted">{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function BookingConfirmation({
  booking,
  onBookings,
  onHome,
}: {
  booking: CreatedBooking;
  onBookings: () => void;
  onHome: () => void;
}) {
  const schedule = formatSchedule(booking.scheduledStart);
  return (
    <View className="rounded-xl border border-brand-200 bg-surface p-6 sm:p-8">
      <Text className="text-sm font-bold text-brand-800 dark:text-brand-300">
        Booking request sent
      </Text>
      <Text className="mt-2 text-3xl font-black text-primary">You’re all set</Text>
      <Text className="mt-2 text-base text-secondary">
        The professional will confirm the price and availability.
      </Text>
      <View className="mt-6 gap-4 border-y border-hairline dark:border-hairline-strong py-5">
        <ReadOnlyValue label="Service" value={booking.service.title} />
        <ReadOnlyValue label="Professional" value={booking.professional.businessName} />
        <ReadOnlyValue label="Scheduled date" value={schedule.date} />
        <ReadOnlyValue label="Scheduled time" value={schedule.time} />
        <ReadOnlyValue label="Booking reference" value={booking.reference} />
        <ReadOnlyValue label="Status" value="REQUESTED" />
      </View>
      <View className="mt-6 flex-row flex-wrap gap-3">
        <Pressable
          accessibilityRole="button"
          onPress={onBookings}
          className="min-h-12 justify-center rounded-lg bg-brand-800 px-5"
        >
          <Text className="font-semibold text-white">View My Bookings</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onHome}
          className="min-h-12 justify-center rounded-lg border border-hairline-strong px-5"
        >
          <Text className="font-semibold text-primary">Back to Home</Text>
        </Pressable>
      </View>
    </View>
  );
}
