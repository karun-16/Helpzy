import { useCallback, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { router } from 'expo-router';
import { MAINTENANCE_BLOCKED_ACTIONS } from '@helpzy/validation';
import type {
  BookingSettings,
  PlatformSettings,
  PlatformSettingsDocument,
  ServiceSettings,
  UpdatePlatformSettings,
} from '@helpzy/validation';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
  RoleScreen,
} from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';

type Response = Awaited<ReturnType<typeof api.admin.platformSettings>>;
type Settings = PlatformSettingsDocument;
/** One draft per section, so editing one never disturbs another. */
type Drafts = {
  booking: BookingSettings;
  service: ServiceSettings;
  platform: PlatformSettings;
};

/**
 * Admin platform settings.
 *
 * Structured as three separate forms rather than one long form because the
 * sections are saved separately and carry different consequences. An admin turning
 * on maintenance mode should not have to re-enter and re-save the price bounds to
 * do it, and the confirmation prompt belongs to that one section only.
 *
 * Each section keeps its own draft. Editing one section does not silently reset
 * unsaved edits in another, and Save sends only what that section changed - which
 * is also what makes the audit log say "platform.maintenanceMode" rather than
 * "every setting".
 */
export function AdminSettingsScreen() {
  const [loaded, setLoaded] = useState<Response | null>(null);
  const [drafts, setDrafts] = useState<Drafts | null>(null);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState<Section | null>(null);

  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    api.admin
      .platformSettings(controller.signal)
      .then((response) => {
        setLoaded(response);
        setDrafts({
          booking: { ...response.settings.booking },
          service: { ...response.settings.service },
          platform: { ...response.settings.platform },
        });
        setLoadError('');
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setLoadError(
            error instanceof ApiError ? error.message : 'Could not load platform settings.',
          );
        }
      });
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      return () => controllerRef.current?.abort();
    }, [load]),
  );

  /**
   * Asks before saving when a change takes effect immediately for real people.
   *
   * `Alert.alert` is a no-op on web, so the web build falls back to a second
   * explicit button press. That is not ideal, but a prompt that silently never
   * appears is worse: the admin would believe they had been asked.
   */
  const confirmSensitive = (title: string, message: string, apply: () => void) => {
    if (Platform.OS === 'web') {
      setNotice('Confirm the change by pressing Save again.');
      return;
    }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Save', style: 'destructive', onPress: apply },
    ]);
  };

  const save = async (section: Section) => {
    if (saving) return;
    const current = loaded?.settings;
    const draft = drafts?.[section];
    if (!current || !draft) return;

    const patch = changedFields(current[section], draft);
    if (Object.keys(patch).length === 0) {
      setSaveError('Nothing has changed in this section.');
      return;
    }

    setSaving(section);
    setSaveError('');
    setNotice('');
    try {
      const response = await api.admin.updatePlatformSettings({
        [section]: patch,
      } as UpdatePlatformSettings);
      setLoaded(response);
      setDrafts((previous) =>
        previous
          ? {
              booking: section === 'booking' ? { ...response.settings.booking } : previous.booking,
              service: section === 'service' ? { ...response.settings.service } : previous.service,
              platform:
                section === 'platform' ? { ...response.settings.platform } : previous.platform,
            }
          : previous,
      );
      setNotice(`${SECTION_LABELS[section]} saved.`);
    } catch (error) {
      // Field-level messages from the API are preferred over a generic line: the
      // cross-field rules produce a message naming the exact pair that conflicts.
      setSaveError(error instanceof ApiError ? error.message : 'Could not save these settings.');
    } finally {
      setSaving(null);
    }
  };

  const update = <K extends Section>(section: K, key: keyof Settings[K], value: unknown) => {
    setDrafts((previous) =>
      previous ? { ...previous, [section]: { ...previous[section], [key]: value } } : previous,
    );
    setSaveError('');
  };

  if (!loaded || !drafts) {
    return (
      <RoleScreen role="ADMIN" homeRoute="/admin" onHome={() => router.back()}>
        {loadError ? (
          <InlineError message={loadError} />
        ) : (
          <LoadingBlock label="Loading settings..." />
        )}
      </RoleScreen>
    );
  }

  return (
    <RoleScreen role="ADMIN" homeRoute="/admin" onHome={() => router.back()}>
      <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
        {/*
         * A settings read that fell back to defaults is dangerous to show as
         * ordinary: "maintenance is off" is the exact belief that must not be
         * trusted during an outage, so it is stated plainly rather than styled
         * into the page.
         */}
        {loaded.servingDefaultsBecauseReadFailed ? (
          <View className="mb-4 rounded-lg border border-red-300 bg-red-50 p-3 dark:border-red-800 dark:bg-red-950">
            <Text className="text-sm font-semibold text-red-900 dark:text-red-200">
              Settings could not be read
            </Text>
            <Text className="mt-1 text-sm text-red-800 dark:text-red-300">
              HELPZY is serving default values because the settings store is unreachable. What you
              see here is not necessarily what is in force.
            </Text>
          </View>
        ) : null}

        <Text className="text-xs text-tertiary">
          Last changed {new Date(loaded.updatedAt).toLocaleString()}
          {loaded.updatedByName ? ` by ${loaded.updatedByName}` : ''}
        </Text>

        <BookingSection
          value={drafts.booking}
          onChange={(key, next) => update('booking', key, next)}
          onSave={() => save('booking')}
          onCancel={() =>
            setDrafts((p) => (p ? { ...p, booking: { ...loaded.settings.booking } } : p))
          }
          saving={saving === 'booking'}
          busy={saving !== null}
          isDirty={dirty(drafts.booking, loaded.settings.booking)}
        />

        <ServiceSection
          value={drafts.service}
          onChange={(key, next) => update('service', key, next)}
          onSave={() => save('service')}
          onCancel={() =>
            setDrafts((p) => (p ? { ...p, service: { ...loaded.settings.service } } : p))
          }
          saving={saving === 'service'}
          busy={saving !== null}
          isDirty={dirty(drafts.service, loaded.settings.service)}
        />

        <PlatformSection
          value={drafts.platform}
          onChange={(key, next) => update('platform', key, next)}
          onSave={() => save('platform')}
          onCancel={() =>
            setDrafts((p) => (p ? { ...p, platform: { ...loaded.settings.platform } } : p))
          }
          saving={saving === 'platform'}
          busy={saving !== null}
          isDirty={dirty(drafts.platform, loaded.settings.platform)}
          confirmSensitive={confirmSensitive}
        />

        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          className="mt-6 min-h-11 items-center justify-center"
        >
          <Text className="text-sm font-semibold text-secondary">Back to dashboard</Text>
        </Pressable>
      </ScrollView>

      <InlineError message={saveError} />
      <InlineSuccess message={notice} />
    </RoleScreen>
  );
}

type Section = 'booking' | 'service' | 'platform';

const SECTION_LABELS: Record<Section, string> = {
  booking: 'Booking rules',
  service: 'Service rules',
  platform: 'Platform controls',
};

/** Only the keys that actually changed, so the audit entry stays precise. */
function changedFields<T extends object>(current: T, draft: T): Partial<T> {
  const patch: Partial<T> = {};
  for (const key of Object.keys(draft) as Array<keyof T>) {
    if (JSON.stringify(current[key]) !== JSON.stringify(draft[key])) {
      patch[key] = draft[key];
    }
  }
  return patch;
}

function dirty<T extends object>(current: T, draft: T): boolean {
  return Object.keys(changedFields(current, draft)).length > 0;
}

/**
 * A text field that follows the server value when it changes.
 *
 * A text box needs local state so typing is not fought by the parent's value, but
 * the local copy must also follow the server after a save or a refetch. React's
 * documented way to do that is to adjust state during render rather than in an
 * effect: an effect here would cause a second render pass on every load and is
 * exactly the cascading-render pattern the lint rule exists to catch.
 */
function useSyncedText(serverValue: string) {
  const [text, setText] = useState(serverValue);
  const [lastServerValue, setLastServerValue] = useState(serverValue);

  if (serverValue !== lastServerValue) {
    setLastServerValue(serverValue);
    setText(serverValue);
  }

  return { text, setText };
}

// --------------------------------------------------------------------------- booking

function BookingSection({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  busy,
  isDirty,
}: {
  value: BookingSettings;
  onChange: (key: keyof BookingSettings, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  busy: boolean;
  isDirty: boolean;
}) {
  return (
    <SectionCard
      title="Booking rules"
      hint="Applies to new bookings. Bookings already made are never changed by these settings."
    >
      <Choice
        label="Booking availability"
        help="When closed, customers cannot create a booking. Existing bookings continue normally."
        options={[
          { value: 'OPEN', label: 'Open' },
          { value: 'CLOSED', label: 'Closed' },
        ]}
        current={value.availability}
        onSelect={(next) => onChange('availability', next)}
      />

      <NumberField
        label="Minimum notice (minutes)"
        help="How far ahead a booking must be made. 0 means a booking may be made right up to the time."
        value={value.minimumLeadMinutes}
        onChange={(next) => onChange('minimumLeadMinutes', next)}
      />

      <NumberField
        label="Booking horizon (days)"
        help="The furthest ahead a booking may be placed. 0 means no limit."
        value={value.maximumLeadDays}
        onChange={(next) => onChange('maximumLeadDays', next)}
      />

      <NumberField
        label="Cancellation notice (hours)"
        help="A booking cannot be cancelled inside this window before its start time. 0 disables the window."
        value={value.cancellationWindowHours}
        onChange={(next) => onChange('cancellationWindowHours', next)}
      />

      <Toggle
        label="Allow rescheduling"
        help="When off, neither party can propose a different time. Proposals already open can still be answered."
        value={value.reschedulingEnabled}
        onChange={(next) => onChange('reschedulingEnabled', next)}
      />

      <NumberField
        label="Reschedule horizon (days)"
        help="The furthest ahead a booking may be moved to. 0 means no limit."
        value={value.rescheduleMaximumLeadDays}
        onChange={(next) => onChange('rescheduleMaximumLeadDays', next)}
      />

      <SaveRow onSave={onSave} onCancel={onCancel} saving={saving} busy={busy} isDirty={isDirty} />
    </SectionCard>
  );
}

// --------------------------------------------------------------------------- service

function ServiceSection({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  busy,
  isDirty,
}: {
  value: ServiceSettings;
  onChange: (key: keyof ServiceSettings, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  busy: boolean;
  isDirty: boolean;
}) {
  return (
    <SectionCard
      title="Service rules"
      hint="Bounds what a professional may publish."
      help="These can only tighten what the API already refuses, so no combination of settings can make the API accept something it normally rejects."
    >
      <NumberField
        label="Shortest job (minutes)"
        value={value.minimumDurationMinutes}
        onChange={(next) => onChange('minimumDurationMinutes', next)}
      />
      <NumberField
        label="Longest job (minutes)"
        value={value.maximumDurationMinutes}
        onChange={(next) => onChange('maximumDurationMinutes', next)}
      />
      <NumberField
        label="Lowest price"
        help="In rupees."
        value={value.minimumPriceAmount}
        onChange={(next) => onChange('minimumPriceAmount', next)}
      />
      <NumberField
        label="Highest price"
        help="In rupees."
        value={value.maximumPriceAmount}
        onChange={(next) => onChange('maximumPriceAmount', next)}
      />
      <Toggle
        label="Require approval before a new listing is published"
        help="New services are created hidden until an admin approves them. Existing services are unaffected."
        value={value.requireModerationBeforePublish}
        onChange={(next) => onChange('requireModerationBeforePublish', next)}
      />
      <Toggle
        label="Only show verified professionals in the marketplace"
        help="When on, professionals who are unverified, pending or rejected stop appearing in public search. It does not affect existing bookings, and admins still see everyone in the review queues."
        value={value.requireVerifiedForDiscovery}
        onChange={(next) => onChange('requireVerifiedForDiscovery', next)}
      />

      <SaveRow onSave={onSave} onCancel={onCancel} saving={saving} busy={busy} isDirty={isDirty} />
    </SectionCard>
  );
}

// --------------------------------------------------------------------------- platform

function PlatformSection({
  value,
  onChange,
  onSave,
  onCancel,
  saving,
  busy,
  isDirty,
  confirmSensitive,
}: {
  value: PlatformSettings;
  onChange: (key: keyof PlatformSettings, value: unknown) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  busy: boolean;
  isDirty: boolean;
  confirmSensitive: (title: string, message: string, apply: () => void) => void;
}) {
  const announcement = useSyncedText(value.announcementMessage);
  const maintenance = useSyncedText(value.maintenanceMessage);
  const announcementText = announcement.text;
  const setAnnouncementText = announcement.setText;
  const maintenanceText = maintenance.text;
  const setMaintenanceText = maintenance.setText;

  const commitAnnouncement = () => {
    onChange('announcementMessage', announcementText.trim());
    onChange('announcementEnabled', announcementText.trim().length > 0);
  };

  const commitMaintenance = () => {
    onChange('maintenanceMessage', maintenanceText.trim());
  };

  return (
    <SectionCard
      title="Platform controls"
      hint="These affect everyone immediately, including people who are not signed in."
    >
      <Toggle
        label="Maintenance mode"
        help="Shows your maintenance message and blocks the actions selected below. Reading the marketplace keeps working."
        value={value.maintenanceMode}
        onChange={(next) => onChange('maintenanceMode', next)}
      />

      {value.maintenanceMode ? (
        <>
          <Text className="text-sm font-semibold text-primary">Maintenance message</Text>
          <TextInput
            accessibilityLabel="Maintenance message"
            value={maintenanceText}
            onChangeText={setMaintenanceText}
            onBlur={commitMaintenance}
            placeholder="We are upgrading the booking system. Back shortly."
            placeholderTextColor="#94a3b8"
            multiline
            className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
          />
          <Text className="text-xs font-semibold text-secondary">Blocked while in maintenance</Text>
          <View className="gap-2">
            {MAINTENANCE_BLOCKED_ACTIONS.map((action) => {
              const selected = value.maintenanceBlockedActions.includes(action);
              return (
                <Pressable
                  key={action}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={action.replaceAll('_', ' ').toLocaleLowerCase()}
                  onPress={() =>
                    onChange(
                      'maintenanceBlockedActions',
                      selected
                        ? value.maintenanceBlockedActions.filter((entry) => entry !== action)
                        : [...value.maintenanceBlockedActions, action],
                    )
                  }
                  className="min-h-11 flex-row items-center justify-between rounded-lg border border-hairline-strong bg-surface px-3"
                >
                  <Text className="text-sm text-primary">
                    {action.replaceAll('_', ' ').toLocaleLowerCase()}
                  </Text>
                  <View
                    className={`h-5 w-5 rounded border ${
                      selected ? 'border-action-text bg-action-text' : 'border-hairline-strong'
                    }`}
                  />
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      <Text className="text-sm font-semibold text-primary">Platform announcement</Text>
      <TextInput
        accessibilityLabel="Platform announcement"
        value={announcementText}
        onChangeText={setAnnouncementText}
        onBlur={commitAnnouncement}
        placeholder="Shown to everyone who opens the app. Leave empty to remove it."
        placeholderTextColor="#94a3b8"
        multiline
        className="min-h-20 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
      />

      <Choice
        label="Announcement urgency"
        options={[
          { value: 'INFO', label: 'Information' },
          { value: 'WARNING', label: 'Warning' },
          { value: 'CRITICAL', label: 'Critical' },
        ]}
        current={value.announcementSeverity}
        onSelect={(next) => onChange('announcementSeverity', next)}
      />

      <TextField
        label="Support email"
        value={value.supportEmail}
        onChange={(next) => onChange('supportEmail', next.trim())}
      />
      <TextField
        label="Support phone"
        value={value.supportPhone}
        onChange={(next) => onChange('supportPhone', next.trim())}
      />

      <Toggle
        label="Send notifications"
        help="Turning this off suppresses notices only. Bookings, payments and disputes still update and are still recorded correctly."
        value={value.notificationsEnabled}
        onChange={(next) => onChange('notificationsEnabled', next)}
      />

      <View className="flex-row flex-wrap gap-3">
        <ActionButton
          label="Save platform controls"
          onPress={() => {
            /*
             * Maintenance mode and turning notifications off both take effect for
             * real people the moment they are saved, so they get a confirmation
             * rather than saving silently.
             */
            if (value.maintenanceMode || !value.notificationsEnabled) {
              confirmSensitive(
                'Apply these platform controls?',
                'This takes effect immediately for everyone using HELPZY.',
                onSave,
              );
              return;
            }
            onSave();
          }}
          busy={saving}
          disabled={busy || !isDirty}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Discard platform control changes"
          onPress={onCancel}
          disabled={busy}
          className="min-h-11 justify-center px-2"
        >
          <Text className="text-sm font-semibold text-secondary">Discard changes</Text>
        </Pressable>
      </View>
    </SectionCard>
  );
}

// ------------------------------------------------------------------------ primitives

function SectionCard({
  title,
  hint,
  help,
  children,
}: {
  title: string;
  /** One-line summary of what the section governs. Always shown. */
  hint: string;
  /** Longer note shown only for this section. */
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-6 rounded-xl border border-hairline p-4 dark:border-hairline-strong">
      <Text className="text-lg font-bold text-primary">{title}</Text>
      <Text className="mt-1 text-sm text-secondary">{hint}</Text>
      {help ? <Text className="mt-2 text-xs text-tertiary">{help}</Text> : null}
      <View className="mt-4 gap-4">{children}</View>
    </View>
  );
}

function SaveRow({
  onSave,
  onCancel,
  saving,
  busy,
  isDirty,
}: {
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  busy: boolean;
  isDirty: boolean;
}) {
  return (
    <View className="flex-row flex-wrap gap-3">
      <ActionButton label="Save" onPress={onSave} busy={saving} disabled={busy || !isDirty} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Discard changes"
        onPress={onCancel}
        disabled={busy}
        className="min-h-11 justify-center px-2"
      >
        <Text className="text-sm font-semibold text-secondary">Discard changes</Text>
      </Pressable>
    </View>
  );
}

function Toggle({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View className="gap-1">
      <View className="min-h-11 flex-row items-center justify-between gap-3">
        <Text className="flex-1 text-sm font-semibold text-primary">{label}</Text>
        <Switch
          accessibilityLabel={label}
          value={value}
          onValueChange={onChange}
          trackColor={{ true: '#0f766e', false: '#cbd5e1' }}
        />
      </View>
      {help ? <Text className="text-xs text-tertiary">{help}</Text> : null}
    </View>
  );
}

function NumberField({
  label,
  help,
  value,
  onChange,
}: {
  label: string;
  help?: string;
  value: number;
  onChange: (next: number) => void;
}) {
  const field = useSyncedText(String(value));
  const text = field.text;
  const setText = field.setText;

  return (
    <View className="gap-1">
      <Text className="text-sm font-semibold text-primary">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={text}
        // Non-numeric input is held in local state and only committed as a number,
        // so a half-typed value cannot push NaN into the document.
        onChangeText={(next) => {
          const cleaned = next.replace(/[^0-9]/g, '');
          setText(cleaned);
          const parsed = Number.parseInt(cleaned, 10);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        keyboardType="number-pad"
        className="min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
      />
      {help ? <Text className="text-xs text-tertiary">{help}</Text> : null}
    </View>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-semibold text-primary">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        keyboardType={label.includes('email') ? 'email-address' : 'default'}
        className="min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
      />
    </View>
  );
}

function Choice<T extends string>({
  label,
  help,
  options,
  current,
  onSelect,
}: {
  label: string;
  help?: string;
  options: Array<{ value: T; label: string }>;
  current: T;
  onSelect: (next: T) => void;
}) {
  return (
    <View className="gap-1">
      <Text className="text-sm font-semibold text-primary">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((option) => {
          const selected = option.value === current;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => onSelect(option.value)}
              className={`min-h-9 justify-center rounded-lg border px-3 ${
                selected
                  ? 'border-action-text bg-surface-muted'
                  : 'border-hairline-strong bg-surface'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  selected ? 'text-action-text' : 'text-secondary'
                }`}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {help ? <Text className="text-xs text-tertiary">{help}</Text> : null}
    </View>
  );
}
