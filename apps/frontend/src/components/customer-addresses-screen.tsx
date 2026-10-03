import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import type { CustomerAddressDto, UpsertCustomerAddressDto } from '@helpzy/api-client';

import {
  ActionButton,
  EmptyBlock,
  ErrorBlock,
  InlineError,
  LabelledInput,
  LoadingBlock,
  Panel,
  RoleScreen,
  ScreenShell,
  SectionHeading,
} from '@/components/marketplace-ui';
import { api, ApiError } from '@/lib/api';

const ADDRESS_TYPES = ['HOME', 'WORK', 'OTHER'] as const;
type AddressType = (typeof ADDRESS_TYPES)[number];

const EMPTY_ADDRESS: UpsertCustomerAddressDto = {
  label: '',
  type: 'HOME',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  isDefault: false,
};

export function CustomerAddressesScreen() {
  const router = useRouter();
  const [addressResult, setAddressResult] = useState<{
    request: number;
    addresses: CustomerAddressDto[] | null;
    error: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState<UpsertCustomerAddressDto>(EMPTY_ADDRESS);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState('');
  const currentResult = addressResult?.request === reload ? addressResult : null;
  const addresses = currentResult?.addresses ?? null;
  const loadFailed = currentResult?.error ?? false;

  const refresh = useCallback(() => setReload((value) => value + 1), []);

  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      api.customerAccount
        .listAddresses(controller.signal)
        .then((result) => {
          setAddressResult({ request: reload, addresses: result, error: false });
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setAddressResult({ request: reload, addresses: null, error: true });
          }
        });
      return () => controller.abort();
    }, [reload]),
  );

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    const payload: UpsertCustomerAddressDto = {
      ...draft,
      label: draft.label.trim(),
      line1: draft.line1.trim(),
      line2: draft.line2?.trim() || undefined,
      city: draft.city.trim(),
      state: draft.state.trim(),
      postalCode: draft.postalCode.trim(),
    };
    try {
      if (editingId) await api.customerAccount.updateAddress(editingId, payload);
      else await api.customerAccount.createAddress(payload);
      setDraft(EMPTY_ADDRESS);
      setEditingId(null);
      refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t save this address. Check the details and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const setDefault = async (addressId: string) => {
    setBusyAction(true);
    setError('');
    try {
      await api.customerAccount.setDefaultAddress(addressId);
      refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'We couldn’t update the default.',
      );
    } finally {
      setBusyAction(false);
    }
  };

  const deleteAddress = async () => {
    if (!deleteId || busyAction) return;
    setBusyAction(true);
    setError('');
    try {
      await api.customerAccount.deleteAddress(deleteId);
      setDeleteId(null);
      refresh();
    } catch (requestError) {
      setError(
        requestError instanceof ApiError
          ? requestError.message
          : 'We couldn’t delete this address.',
      );
    } finally {
      setBusyAction(false);
    }
  };

  const startEditing = (address: CustomerAddressDto) => {
    setEditingId(address.id);
    setError('');
    setDraft({
      label: address.label,
      type: address.type as AddressType,
      line1: address.line1,
      line2: address.line2 ?? '',
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      isDefault: address.isDefault,
    });
  };

  const valid =
    draft.label.trim().length > 0 &&
    draft.line1.trim().length >= 3 &&
    draft.city.trim().length >= 2 &&
    draft.state.trim().length >= 2 &&
    draft.postalCode.trim().length >= 3;

  return (
    <RoleScreen role="CUSTOMER" homeRoute="/customer" onHome={() => router.replace('/customer')}>
      <ScreenShell>
        <SectionHeading
          title="Saved Addresses"
          onBack={() => router.replace('/customer/settings')}
        />
        <Panel
          title="Your addresses"
          subtitle="Saved addresses are available when you request a service."
        >
          {addresses === null && !loadFailed ? (
            <LoadingBlock label="Loading saved addresses..." />
          ) : loadFailed ? (
            <ErrorBlock onRetry={refresh} />
          ) : addresses?.length === 0 ? (
            <EmptyBlock
              title="No saved addresses yet"
              detail="Add an address below to make booking quicker."
            />
          ) : (
            <View className="gap-3">
              {addresses?.map((address) => (
                <View
                  key={address.id}
                  className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
                >
                  <View className="flex-row flex-wrap items-start justify-between gap-2">
                    <View className="min-w-40 flex-1">
                      <Text className="font-semibold text-primary">{address.label}</Text>
                      <Text className="mt-1 text-sm leading-5 text-secondary">
                        {[
                          address.line1,
                          address.line2,
                          `${address.city}, ${address.state} ${address.postalCode}`,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                      </Text>
                    </View>
                    <Text className="text-xs font-semibold uppercase text-muted">
                      {address.isDefault ? 'Default' : address.type}
                    </Text>
                  </View>
                  {deleteId === address.id ? (
                    <View className="mt-3 rounded-md bg-danger-soft p-3">
                      <Text className="text-sm font-medium text-primary">
                        Delete this saved address?
                      </Text>
                      <View className="mt-2 flex-row flex-wrap gap-2">
                        <ActionButton
                          label="Confirm delete"
                          tone="danger"
                          onPress={deleteAddress}
                          busy={busyAction}
                        />
                        <ActionButton
                          label="Keep address"
                          tone="subtle"
                          onPress={() => setDeleteId(null)}
                          disabled={busyAction}
                        />
                      </View>
                    </View>
                  ) : (
                    <View className="mt-3 flex-row flex-wrap gap-4">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${address.label}`}
                        onPress={() => startEditing(address)}
                        className="min-h-10 justify-center"
                      >
                        <Text className="text-sm font-semibold text-action-text">Edit</Text>
                      </Pressable>
                      {!address.isDefault ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={busyAction}
                          onPress={() => void setDefault(address.id)}
                          className="min-h-10 justify-center"
                        >
                          <Text className="text-sm font-semibold text-action-text">
                            Make default
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setDeleteId(address.id)}
                        className="min-h-10 justify-center"
                      >
                        <Text className="text-sm font-semibold text-danger">Delete</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))}
            </View>
          )}
        </Panel>

        <Panel title={editingId ? 'Edit address' : 'Add an address'}>
          <LabelledInput
            label="Label"
            value={draft.label}
            onChangeText={(label) => setDraft({ ...draft, label })}
            placeholder="Home, Office..."
          />
          <View className="mt-4 flex-row flex-wrap gap-2">
            {ADDRESS_TYPES.map((type) => (
              <Pressable
                key={type}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.type === type }}
                onPress={() => setDraft({ ...draft, type })}
                className={`min-h-10 justify-center rounded-control px-3 ${draft.type === type ? 'bg-action-fill' : 'border border-hairline-strong bg-surface'}`}
              >
                <Text
                  className={`text-sm font-semibold ${draft.type === type ? 'text-white' : 'text-primary'}`}
                >
                  {type}
                </Text>
              </Pressable>
            ))}
          </View>
          <LabelledInput
            label="Address line 1"
            value={draft.line1}
            onChangeText={(line1) => setDraft({ ...draft, line1 })}
          />
          <LabelledInput
            label="Address line 2 (optional)"
            value={draft.line2 ?? ''}
            onChangeText={(line2) => setDraft({ ...draft, line2 })}
          />
          <View className="flex-row flex-wrap gap-3">
            <View className="min-w-40 flex-1">
              <LabelledInput
                label="City"
                value={draft.city}
                onChangeText={(city) => setDraft({ ...draft, city })}
              />
            </View>
            <View className="min-w-40 flex-1">
              <LabelledInput
                label="State"
                value={draft.state}
                onChangeText={(state) => setDraft({ ...draft, state })}
              />
            </View>
            <View className="min-w-32 flex-1">
              <LabelledInput
                label="Postal code"
                value={draft.postalCode}
                onChangeText={(postalCode) => setDraft({ ...draft, postalCode })}
                autoCapitalize="characters"
              />
            </View>
          </View>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: Boolean(draft.isDefault) }}
            onPress={() => setDraft({ ...draft, isDefault: !draft.isDefault })}
            className="mt-3 min-h-10 flex-row items-center gap-3"
          >
            <View
              className={`h-5 w-5 rounded border ${draft.isDefault ? 'border-action-fill bg-action-fill' : 'border-hairline-strong'}`}
            />
            <Text className="text-sm text-primary">Make this my default address</Text>
          </Pressable>
          <InlineError message={error} />
          <ActionButton
            label={editingId ? 'Save changes' : 'Add address'}
            onPress={submit}
            busy={saving}
            disabled={!valid}
          />
          {editingId ? (
            <ActionButton
              label="Cancel editing"
              tone="subtle"
              onPress={() => {
                setDraft(EMPTY_ADDRESS);
                setEditingId(null);
                setError('');
              }}
            />
          ) : null}
        </Panel>
      </ScreenShell>
    </RoleScreen>
  );
}
