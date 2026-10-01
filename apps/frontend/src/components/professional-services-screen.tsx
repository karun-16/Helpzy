import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

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

/**
 * The professional's own service list.
 *
 * Withdrawal sets `isActive: false` and hides the service from customers without
 * losing booking history. Deletion is refused by the API once the service has
 * been booked, and that refusal is shown as-is rather than worked around.
 */
export function ProfessionalServicesScreen() {
  const router = useRouter();
  const [services, setServices] = useState<ServiceRecord[] | null>(null);
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionNotice, setActionNotice] = useState('');
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null);

  const loadedServices = services ?? [];

  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

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

  const save = async () => {
    setSaving(true);
    setFormError('');
    setActionError('');
    setActionNotice('');
    try {
      const priceAmount = Number(draft.priceAmount);
      const durationMinutes = Number(draft.durationMinutes);
      if (!Number.isFinite(priceAmount) || priceAmount < 0) {
        throw new Error('Enter a price of 0 or more.');
      }
      if (!Number.isInteger(durationMinutes) || durationMinutes < 15) {
        throw new Error('Duration must be a whole number of 15 minutes or more.');
      }
      const payload = {
        categoryId: draft.categoryId,
        title: draft.title.trim(),
        description: draft.description.trim(),
        priceAmount,
        durationMinutes,
        ...(draft.summary.trim() ? { summary: draft.summary.trim() } : {}),
      };
      if (editingId) {
        await api.professionalServices.update(editingId, payload);
      } else {
        await api.professionalServices.create({
          ...payload,
          currency: 'INR',
        } as Parameters<typeof api.professionalServices.create>[0]);
      }
      setDraft(EMPTY_DRAFT);
      setEditingId(null);
      setActionNotice(editingId ? 'Service updated.' : 'Service published.');
      load();
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'We couldn’t save that service.',
      );
    } finally {
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
            {loadedServices.map((service) => (
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
                      service.isActive
                        ? 'bg-brand-100 dark:bg-brand-950'
                        : 'bg-surface-muted dark:bg-slate-800'
                    }`}
                  >
                    <Text
                      className={`text-xs font-bold uppercase ${
                        service.isActive
                          ? 'text-brand-800 dark:text-brand-300'
                          : 'text-secondary dark:text-secondary'
                      }`}
                    >
                      {service.isActive ? 'Live' : 'Withdrawn'}
                    </Text>
                  </View>
                </View>
                <View className="mt-4 flex-row flex-wrap gap-x-6 gap-y-1">
                  <Text className="text-sm font-semibold text-primary">
                    {formatMoney(service.priceAmount, service.currency)}
                  </Text>
                  <Text className="text-sm text-secondary">{service.durationMinutes} minutes</Text>
                  <Text className="text-sm text-secondary">
                    {service.bookingCount} booking{service.bookingCount === 1 ? '' : 's'}
                  </Text>
                </View>
                <Text className="mt-2 text-sm leading-5 text-secondary">{service.description}</Text>
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
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      service.isActive ? `Withdraw ${service.title}` : `Republish ${service.title}`
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
            ))}
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
                onPress={() => setDraft({ ...draft, categoryId: category.id })}
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
          ) : null}

          <LabelledInput
            label="Title"
            value={draft.title}
            onChangeText={(next) => setDraft({ ...draft, title: next })}
            placeholder="AC servicing and repair"
          />
          <LabelledInput
            label="Summary (optional)"
            value={draft.summary}
            onChangeText={(next) => setDraft({ ...draft, summary: next })}
          />
          <LabelledInput
            label="Description"
            value={draft.description}
            onChangeText={(next) => setDraft({ ...draft, description: next })}
            multiline
          />
          <LabelledInput
            label="Price"
            value={draft.priceAmount}
            onChangeText={(next) => setDraft({ ...draft, priceAmount: next })}
            keyboardType="decimal-pad"
          />
          <LabelledInput
            label="Duration in minutes"
            value={draft.durationMinutes}
            onChangeText={(next) => setDraft({ ...draft, durationMinutes: next })}
            keyboardType="number-pad"
          />
          <ActionButton
            label={editingId ? 'Save service' : 'Publish service'}
            onPress={save}
            busy={saving}
            disabled={
              draft.title.trim().length < 3 ||
              draft.description.trim().length < 10 ||
              draft.priceAmount.trim() === '' ||
              draft.categoryId === ''
            }
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
