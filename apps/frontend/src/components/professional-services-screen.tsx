import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SERVICE_MODERATION_STATUSES } from '@helpzy/types';

import {
  ActionButton,
  ErrorBlock,
  formatMoney,
  InlineError,
  InlineSuccess,
  LabelledInput,
  LoadingBlock,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';

type ServiceRecord = Awaited<ReturnType<typeof api.professionalServices.list>>[number];
type CategoryOption = Awaited<ReturnType<typeof api.professionalServices.listCategories>>[number];

const EMPTY_DRAFT = {
  categoryId: '',
  title: '',
  summary: '',
  description: '',
  priceAmount: '',
  durationMinutes: '60',
};

/** Mirrors the backend limits, so the form explains itself before a round trip. */
const PRICE_MAX = 10_000_000;
const DURATION_MIN = 15;
const DURATION_MAX = 1440;

type DraftField =
  'categoryId' | 'title' | 'summary' | 'description' | 'priceAmount' | 'durationMinutes';

/**
 * One validation pass for the whole form, keyed by field.
 *
 * The submit path and the inline messages both read this, so a professional can
 * never be told one thing by the button and another by the error text. Every
 * problem is returned rather than only the first: fixing one field at a time
 * while being re-told about a different one is the slowest way to fill a form.
 */
function validateDraft(
  draft: typeof EMPTY_DRAFT,
  categories: CategoryOption[] | null,
): Array<{ field: DraftField; message: string }> {
  const priceAmount = Number(draft.priceAmount);
  const durationMinutes = Number(draft.durationMinutes);
  const problems: Array<{ field: DraftField; message: string }> = [];

  if (!categories?.some((category) => category.id === draft.categoryId)) {
    problems.push({ field: 'categoryId', message: 'Choose an available service category.' });
  }
  if (draft.title.trim().length < 3 || draft.title.trim().length > 160) {
    problems.push({
      field: 'title',
      message: 'Service title must be between 3 and 160 characters.',
    });
  }
  if (draft.summary.trim().length > 300) {
    problems.push({ field: 'summary', message: 'Summary must be 300 characters or fewer.' });
  }
  if (draft.description.trim().length < 10 || draft.description.trim().length > 4000) {
    problems.push({
      field: 'description',
      message: 'Description must be between 10 and 4,000 characters.',
    });
  }
  if (!Number.isFinite(priceAmount) || priceAmount <= 0 || priceAmount > PRICE_MAX) {
    problems.push({
      field: 'priceAmount',
      message: `Enter a price greater than 0 and no more than ${PRICE_MAX.toLocaleString()}.`,
    });
  }
  if (
    !Number.isInteger(durationMinutes) ||
    durationMinutes < DURATION_MIN ||
    durationMinutes > DURATION_MAX
  ) {
    problems.push({
      field: 'durationMinutes',
      message: `Duration must be a whole number from ${DURATION_MIN} minutes to ${DURATION_MAX / 60} hours.`,
    });
  }
  return problems;
}

/**
 * Turns whatever `save` threw into one sentence a professional can act on.
 *
 * The raw failures were unreadable: a client-side Zod error serialised as a JSON
 * blob, and an API validation failure collapsed to the generic "Please check the
 * details". The API already sends per-field messages in `details`, so those are
 * preferred over the generic summary.
 */
function readableError(error: unknown): string {
  if (error instanceof ApiError) {
    const fields = (error.details ?? [])
      .map((detail) => detail.messages?.[0])
      .filter((message): message is string => Boolean(message));
    if (fields.length) return fields.join(' ');
    if (error.isNetworkError) {
      return 'We could not reach HELPZY. Check your connection and try again.';
    }
    return error.message;
  }
  if (error instanceof Error) {
    // A Zod failure means the client-side contract check tripped; its `message`
    // is a JSON dump, so it is replaced with something actionable.
    if (error.name === 'ZodError') {
      return 'Some of these details are not valid yet. Please review the form.';
    }
    return error.message;
  }
  return 'We couldn’t save that service.';
}

/**
 * What a listing means right now, for the pill and the notice.
 *
 * The moderation state decides the label, not `isActive` alone: a
 * listing awaiting review reads "Pending review" even though it is
 * hidden, and one an admin withdrew reads "Rejected", so the two
 * hidden states are never confused with each other or with the
 * professional's own withdrawal. Only an approved listing is simply
 * live or withdrawn.
 */
function moderationLabel(service: ServiceRecord): {
  label: string;
  tone: 'live' | 'muted' | 'pending' | 'rejected';
} {
  switch (service.moderationStatus) {
    case SERVICE_MODERATION_STATUSES.PENDING:
      return { label: 'Pending review', tone: 'pending' };
    case SERVICE_MODERATION_STATUSES.REJECTED:
      return { label: 'Rejected', tone: 'rejected' };
    default:
      return service.isActive
        ? { label: 'Live', tone: 'live' }
        : { label: 'Withdrawn', tone: 'muted' };
  }
}

/**
 * The professional's own service list.
 *
 * Withdrawal sets `isActive: false` and hides the service from customers without
 * losing booking history. Deletion is refused by the API once the service has
 * been booked, and that refusal is shown as-is rather than worked around.
 */
/** The problem under one field, or null when that field is fine. */
function FieldMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text
      accessibilityRole="alert"
      className="-mt-1 mb-1 text-sm font-medium text-rose-700 dark:text-rose-300"
    >
      {message}
    </Text>
  );
}

export function ProfessionalServicesScreen() {
  const router = useRouter();
  const [services, setServices] = useState<ServiceRecord[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);

  const loadedServices = services ?? [];

  /*
   * Only after a publish attempt: an untouched form should not start by telling
   * the professional that every empty field is wrong.
   */
  const fieldMessage = (field: DraftField): string | null => {
    if (!attempted) return null;
    return validateDraft(draft, categories).find((p) => p.field === field)?.message ?? null;
  };

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  /* Whether the professional has tried to publish; gates the inline messages. */
  const [attempted, setAttempted] = useState(false);
  const saveInProgressRef = useRef(false);

  // Shared abort scope, so a manual reload and the focus reload cancel together.
  const controllerRef = useRef<AbortController | null>(null);

  const fetchServices = useCallback(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    api.professionalServices
      .list(controller.signal)
      .then((data) => {
        setServices(data);
        setFailed(false);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
  }, []);

  const load = useCallback(() => fetchServices(), [fetchServices]);

  useFocusEffect(
    useCallback(() => {
      fetchServices();
      return () => controllerRef.current?.abort();
    }, [fetchServices]),
  );

  useEffect(() => {
    const controller = new AbortController();
    api.professionalServices
      .listCategories(controller.signal)
      .then((options) => {
        setCategories(options);
        // Preselect the first real category so the form is usable immediately.
        setDraft((current) =>
          current.categoryId === '' && options[0]
            ? { ...current, categoryId: options[0].id }
            : current,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setCategories([]);
      });
    return () => controller.abort();
  }, []);

  /*
   * Every field edit goes through here so a previous failure message is cleared
   * as soon as the professional starts correcting it. Leaving the old text up
   * next to an input that is now correct reads as if the fix did not work.
   */
  const updateDraft = (next: typeof EMPTY_DRAFT) => {
    setDraft(next);
    setFormError('');
  };

  const save = async () => {
    if (saveInProgressRef.current) return;
    saveInProgressRef.current = true;
    setSaving(true);
    setFormError('');
    setActionError('');
    setActionNotice('');
    try {
      const problems = validateDraft(draft, categories);
      if (problems.length) {
        /*
         * The problems are already shown next to the fields that caused them, so
         * no summary is set here - repeating them would just print the same
         * sentences twice. Marked as attempted so an untouched form stays quiet.
         */
        setAttempted(true);
        return;
      }
      const priceAmount = Number(draft.priceAmount);
      const durationMinutes = Number(draft.durationMinutes);
      const payload = {
        title: draft.title.trim(),
        summary: draft.summary.trim() || null,
        description: draft.description.trim(),
        priceAmount,
        durationMinutes,
      };
      let savedService: ServiceRecord;
      if (editingId) {
        /*
         * No `categoryId` here on purpose. A service's category is fixed once it
         * exists - the update schema is strict and the API ignores category
         * changes - so sending it made the client-side parse throw before any
         * request was made, and every edit failed with a raw Zod error.
         */
        savedService = await api.professionalServices.update(editingId, payload);
        setServices((current) =>
          current
            ? current.map((service) => (service.id === editingId ? savedService : service))
            : [savedService],
        );
      } else {
        savedService = await api.professionalServices.create({
          ...payload,
          categoryId: draft.categoryId,
          currency: 'INR',
        });
        setServices((current) =>
          current
            ? [savedService, ...current.filter((service) => service.id !== savedService.id)]
            : [savedService],
        );
      }
      setFailed(false);
      setDraft({ ...EMPTY_DRAFT, categoryId: categories?.[0]?.id ?? '' });
      setEditingId(null);
      // Only a successful save clears the form, and only then do the inline
      // messages go away.
      setAttempted(false);
      setActionNotice(
        editingId
          ? 'Service updated.'
          : savedService.moderationStatus === SERVICE_MODERATION_STATUSES.PENDING
            ? 'Service submitted. It appears on the marketplace once reviewed.'
            : savedService.isActive
              ? 'Service published. Customers can find it on the marketplace.'
              : 'Service saved but inactive; activate it before customers can find it.',
      );
    } catch (error) {
      setFormError(readableError(error));
    } finally {
      saveInProgressRef.current = false;
      setSaving(false);
    }
  };

  const toggleActive = async (service: ServiceRecord) => {
    setBusyServiceId(service.id);
    setActionError('');
    setActionNotice('');
    try {
      await api.professionalServices.update(service.id, { isActive: !service.isActive });
      setActionNotice(
        service.isActive
          ? `"${service.title}" is withdrawn and hidden from customers.`
          : `"${service.title}" is live again.`,
      );
      load();
    } catch (requestError) {
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t update that service.',
      );
    } finally {
      setBusyServiceId(null);
    }
  };

  const remove = async (service: ServiceRecord) => {
    setBusyServiceId(service.id);
    setActionError('');
    setActionNotice('');
    try {
      await api.professionalServices.remove(service.id);
      setActionNotice(`"${service.title}" was deleted.`);
      load();
    } catch (requestError) {
      // The API refuses to delete a service that has booking history, because
      // those bookings must keep pointing at a real service.
      setActionError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t delete that service.',
      );
    } finally {
      setBusyServiceId(null);
    }
  };

  return (
    <RoleScreen
      role="PROFESSIONAL"
      homeRoute="/professional"
      onHome={() => router.replace('/professional')}
    >
      <ScreenShell>
        <SectionHeading
          title="My Services"
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
        <Text className="mt-2 text-base text-secondary">
          Only services you publish here can be found and booked by customers.
        </Text>

        {services === null && !failed ? (
          <LoadingBlock label="Loading your services..." />
        ) : failed ? (
          <ErrorBlock onRetry={load} />
        ) : loadedServices.length === 0 ? (
          <View className="mt-5 rounded-xl border border-hairline dark:border-hairline-strong bg-surface px-5 py-8">
            <Text className="text-base font-semibold text-primary">No services yet</Text>
            <Text className="mt-1 text-sm text-secondary">
              Publish your first service below so customers can book it.
            </Text>
          </View>
        ) : (
          <View className="mt-5 gap-3">
            {loadedServices.map((service) => {
              const status = moderationLabel(service);
              return (
                <View
                  key={service.id}
                  className="rounded-xl border border-hairline dark:border-hairline-strong bg-surface p-5"
                >
                  <View className="flex-row flex-wrap items-start justify-between gap-3">
                    <View className="min-w-48 flex-1">
                      <Text className="text-base font-bold text-primary">{service.title}</Text>
                      <Text className="mt-1 text-sm text-secondary">{service.category.name}</Text>
                    </View>
                    <View
                      className={`rounded-full px-2.5 py-1 ${
                        status.tone === 'live'
                          ? 'bg-brand-100 dark:bg-brand-950'
                          : status.tone === 'pending'
                            ? 'bg-amber-100 dark:bg-amber-950'
                            : status.tone === 'rejected'
                              ? 'bg-rose-100 dark:bg-rose-950'
                              : 'bg-surface-muted dark:bg-slate-800'
                      }`}
                    >
                      <Text
                        className={`text-xs font-bold uppercase ${
                          status.tone === 'live'
                            ? 'text-brand-800 dark:text-brand-300'
                            : status.tone === 'pending'
                              ? 'text-amber-800 dark:text-amber-300'
                              : status.tone === 'rejected'
                                ? 'text-rose-800 dark:text-rose-300'
                                : 'text-secondary dark:text-secondary'
                        }`}
                      >
                        {status.label}
                      </Text>
                    </View>
                  </View>
                  <View className="mt-4 flex-row flex-wrap gap-x-6 gap-y-1">
                    <Text className="text-sm font-semibold text-primary">
                      {formatMoney(service.priceAmount, service.currency)}
                    </Text>
                    <Text className="text-sm text-secondary">
                      {service.durationMinutes} minutes
                    </Text>
                    <Text className="text-sm text-secondary">
                      {service.bookingCount} booking{service.bookingCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Text className="mt-2 text-sm leading-5 text-secondary">
                    {service.description}
                  </Text>
                  {/*
                   A listing awaiting review. There is no note yet - the
                   decision has not been made - so the professional is told
                   what is happening rather than left wondering why a
                   listing they just published is hidden.
                 */}
                  {status.tone === 'pending' ? (
                    <View className="mt-3 rounded-xl border border-hairline bg-amber-50 p-3 dark:bg-amber-950/40">
                      <Text className="text-xs font-bold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                        Awaiting review
                      </Text>
                      <Text className="mt-1 text-sm text-secondary">
                        This listing is waiting to be reviewed. It appears on the marketplace once
                        it is approved.
                      </Text>
                    </View>
                  ) : null}
                  {/*
                   Set only when an admin has withdrawn the listing. The
                   professional's own "Withdraw" toggle leaves it null, so this
                   block always means a decision made by someone else and always
                   says why.
                 */}
                  {service.moderationNote ? (
                    <View className="mt-3 rounded-xl border border-hairline bg-surface-muted p-3">
                      <Text className="text-xs font-bold uppercase tracking-wide text-secondary">
                        Rejected by HELPZY
                      </Text>
                      <Text className="mt-1 text-sm text-primary">{service.moderationNote}</Text>
                      <Text className="mt-2 text-xs text-secondary">
                        Customers cannot find this listing while it is rejected. Your past bookings
                        are unaffected. You can edit the listing and contact support to have it
                        reviewed again.
                      </Text>
                    </View>
                  ) : null}
                  <View className="mt-4 flex-row flex-wrap gap-4">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${service.title}`}
                      onPress={() => {
                        setEditingId(service.id);
                        setFormError('');
                        setDraft({
                          categoryId: service.category.id,
                          title: service.title,
                          summary: service.summary ?? '',
                          description: service.description,
                          priceAmount: String(service.priceAmount),
                          durationMinutes: String(service.durationMinutes),
                        });
                      }}
                    >
                      <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                        Edit
                      </Text>
                    </Pressable>
                    {/*
                    Visibility is the professional's own control only once a
                    moderator has approved the listing. A listing still awaiting
                    review, or one an admin withdrew, is shown and hidden by the
                    platform, so the toggle is not offered for it.
                  */}
                    {status.tone === 'live' || status.tone === 'muted' ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          service.isActive
                            ? `Withdraw ${service.title}`
                            : `Republish ${service.title}`
                        }
                        accessibilityState={{
                          busy: busyServiceId === service.id,
                          disabled: busyServiceId === service.id,
                        }}
                        disabled={busyServiceId === service.id}
                        onPress={() => toggleActive(service)}
                      >
                        <Text className="text-sm font-semibold text-brand-800 dark:text-brand-300">
                          {service.isActive ? 'Withdraw' : 'Republish'}
                        </Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${service.title}`}
                      accessibilityState={{
                        busy: busyServiceId === service.id,
                        disabled: busyServiceId === service.id,
                      }}
                      disabled={busyServiceId === service.id}
                      onPress={() => remove(service)}
                    >
                      <Text className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                        Delete
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        <InlineError message={actionError} />
        <InlineSuccess message={actionNotice} />

        <Panel
          title={editingId ? 'Edit service' : 'Publish a new service'}
          subtitle="Price and duration are what customers will see and agree to."
        >
          <Text className="text-xs font-semibold uppercase text-muted">Category</Text>
          <View className="mt-2 flex-row flex-wrap gap-2">
            {(categories ?? []).map((category) => (
              <Pressable
                key={category.id}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.categoryId === category.id }}
                onPress={() => updateDraft({ ...draft, categoryId: category.id })}
                className={`min-h-11 justify-center rounded-lg px-4 ${
                  draft.categoryId === category.id
                    ? 'bg-brand-800'
                    : 'border border-hairline-strong dark:border-hairline-strong'
                }`}
              >
                <Text
                  className={`text-sm font-semibold ${
                    draft.categoryId === category.id
                      ? 'text-white'
                      : 'text-secondary dark:text-primary'
                  }`}
                >
                  {category.name}
                </Text>
              </Pressable>
            ))}
          </View>
          {categories && categories.length === 0 ? (
            <Text className="mt-2 text-sm text-secondary">
              No categories are published, so a service cannot be created yet.
            </Text>
          ) : fieldMessage('categoryId') ? (
            <Text
              accessibilityRole="alert"
              className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-300"
            >
              {fieldMessage('categoryId')}
            </Text>
          ) : null}

          <LabelledInput
            label="Title"
            value={draft.title}
            onChangeText={(next) => updateDraft({ ...draft, title: next })}
            placeholder="AC servicing and repair"
          />
          <FieldMessage message={fieldMessage('title')} />
          <LabelledInput
            label="Summary (optional)"
            value={draft.summary}
            onChangeText={(next) => updateDraft({ ...draft, summary: next })}
          />
          <FieldMessage message={fieldMessage('summary')} />
          <LabelledInput
            label="Description"
            value={draft.description}
            onChangeText={(next) => updateDraft({ ...draft, description: next })}
            multiline
          />
          <FieldMessage message={fieldMessage('description')} />
          <LabelledInput
            label="Price"
            value={draft.priceAmount}
            onChangeText={(next) => updateDraft({ ...draft, priceAmount: next })}
            keyboardType="decimal-pad"
          />
          <FieldMessage message={fieldMessage('priceAmount')} />
          <LabelledInput
            label="Duration in minutes"
            value={draft.durationMinutes}
            onChangeText={(next) => updateDraft({ ...draft, durationMinutes: next })}
            keyboardType="number-pad"
          />
          <FieldMessage message={fieldMessage('durationMinutes')} />
          <ActionButton
            label={editingId ? 'Save service' : 'Publish service'}
            onPress={save}
            busy={saving}
            disabled={categories !== null && categories.length === 0}
          />
          {editingId ? (
            <ActionButton
              label="Cancel editing"
              tone="subtle"
              onPress={() => {
                setDraft(EMPTY_DRAFT);
                setEditingId(null);
                setFormError('');
              }}
            />
          ) : null}
          <InlineError message={formError} />
        </Panel>
      </ScreenShell>
    </RoleScreen>
  );
}
