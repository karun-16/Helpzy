import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import {
  ActionButton,
  InlineError,
  InlineSuccess,
  LoadingBlock,
} from '@/components/marketplace-ui';
import { StatusBadge } from '@/components/ui';
import { api, ApiError } from '@/lib/api';

type Category = Awaited<ReturnType<typeof api.admin.categories>>[number];

/**
 * Admin control over the marketplace's categories.
 *
 * Nothing here deletes: a category is switched on and off, which is what
 * withdrawing it from public discovery actually means. Editing a name, its
 * description and its position is offered inline, because an admin correcting a
 * typo should not have to open a separate screen.
 */
export function AdminCategoryManagement() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [search, setSearch] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  /** Deactivation asks for a reason so the audit trail explains itself. */
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  /**
   * The search is debounced, so a slow first response must not overwrite the
   * results of a later one. The ref is bumped per load and only the newest load
   * is allowed to write state.
   */
  const loadSeq = useRef(0);

  const load = useCallback((searchTerm = '') => {
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    const controller = new AbortController();
    api.admin
      .categories(searchTerm ? { search: searchTerm } : {}, controller.signal)
      .then((result) => {
        if (loadSeq.current === seq) setCategories(result);
      })
      .catch((requestError) => {
        if (loadSeq.current !== seq) return;
        // An abort is this component cancelling its own request, not a failure.
        if (requestError instanceof ApiError || !(requestError instanceof Error)) {
          setError('Could not load categories.');
        }
      });
    return () => controller.abort();
  }, []);

  const trimmedSearch = search.trim();

  useEffect(() => {
    const timer = setTimeout(() => load(trimmedSearch), 200);
    return () => clearTimeout(timer);
  }, [load, trimmedSearch]);

  const busyCreate = busy === 'create';

  const create = async () => {
    if (busy) return;
    setBusy('create');
    setError('');
    setNotice('');
    try {
      await api.admin.createCategory({
        name: name.trim(),
        description: description.trim() || null,
      });
      setName('');
      setDescription('');
      setNotice('Category created. It is live on the marketplace now.');
      load(trimmedSearch);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not create category.',
      );
    } finally {
      setBusy(null);
    }
  };

  const beginEdit = (category: Category) => {
    setDeactivatingId(null);
    setReason('');
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description ?? '');
    setError('');
    setNotice('');
  };

  const beginDeactivate = (category: Category) => {
    setEditingId(null);
    setDeactivatingId(category.id);
    setReason('');
    setError('');
    setNotice('');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const cancelDeactivate = () => {
    setDeactivatingId(null);
    setReason('');
  };

  const saveEdit = async (category: Category) => {
    if (busy) return;
    setBusy(`edit:${category.id}`);
    setError('');
    setNotice('');
    try {
      await api.admin.updateCategory(category.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
      });
      setNotice(`"${category.name}" updated.`);
      setEditingId(null);
      load(trimmedSearch);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not update category.',
      );
    } finally {
      setBusy(null);
    }
  };

  /**
   * Moves a category one slot up or down the list.
   *
   * Only the two neighbours swap: the server orders by `sortOrder`, so writing
   * the pair of neighbouring values is enough to change the order and avoids
   * renumbering the whole catalogue on every press.
   */
  const reorder = async (category: Category, direction: -1 | 1) => {
    const index = categories?.findIndex((entry) => entry.id === category.id) ?? -1;
    const neighbour = categories?.[index + direction];
    if (busy || index === -1 || !neighbour) return;

    setBusy(`move:${category.id}`);
    setError('');
    setNotice('');
    try {
      await api.admin.updateCategory(category.id, { sortOrder: neighbour.sortOrder });
      await api.admin.updateCategory(neighbour.id, { sortOrder: category.sortOrder });
      setNotice('Category order updated.');
      load(trimmedSearch);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not reorder categories.',
      );
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (category: Category, isActive: boolean, why?: string) => {
    if (busy) return;
    setBusy(category.id);
    setError('');
    setNotice('');
    try {
      await api.admin.setCategoryStatus(category.id, {
        isActive,
        ...(why ? { reason: why } : {}),
      });
      setNotice(
        isActive
          ? `"${category.name}" is live on the marketplace again.`
          : `"${category.name}" was withdrawn. Its ${category.serviceCount} listing${
              category.serviceCount === 1 ? '' : 's'
            } stay in place and reappear when it is restored.`,
      );
      setDeactivatingId(null);
      setReason('');
      load(trimmedSearch);
    } catch (requestError) {
      setError(
        requestError instanceof ApiError ? requestError.message : 'Could not update category.',
      );
    } finally {
      setBusy(null);
    }
  };

  const counts = useMemo(
    () => ({
      total: categories?.length ?? 0,
      active: categories?.filter((category) => category.isActive).length ?? 0,
    }),
    [categories],
  );

  return (
    <View className="mt-8">
      <Text className="text-xl font-bold text-primary">Category management</Text>
      <Text className="mt-1 text-sm text-secondary">
        Add categories, correct their details, and control which of them customers can see. A
        category is never deleted - deactivating one hides it and its listings until you restore it.
      </Text>
      <TextInput
        accessibilityLabel="Search categories"
        value={search}
        onChangeText={setSearch}
        placeholder="Search categories"
        placeholderTextColor="#94a3b8"
        className="mt-3 min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
      />

      <View className="mt-3 rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong">
        <Text className="text-sm font-semibold text-primary">New category</Text>
        <TextInput
          accessibilityLabel="Category name"
          value={name}
          onChangeText={setName}
          placeholder="Category name"
          placeholderTextColor="#94a3b8"
          className="mt-3 min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
        />
        <TextInput
          accessibilityLabel="Category description"
          value={description}
          onChangeText={setDescription}
          placeholder="Description (optional)"
          placeholderTextColor="#94a3b8"
          multiline
          className="mt-3 min-h-16 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
        />
        <ActionButton
          label="Create category"
          onPress={create}
          busy={busyCreate}
          disabled={busy !== null || name.trim().length < 2}
        />
        {name.trim().length > 0 && name.trim().length < 2 ? (
          <Text className="mt-2 text-xs text-danger">
            A category name needs at least 2 characters.
          </Text>
        ) : null}
      </View>

      {categories === null ? (
        <LoadingBlock label="Loading categories..." />
      ) : categories.length === 0 ? (
        <Text className="mt-4 text-sm text-secondary">No categories match this search.</Text>
      ) : (
        <View className="mt-4 gap-3">
          <Text className="text-xs font-semibold uppercase tracking-wide text-secondary">
            {counts.total} categor{counts.total === 1 ? 'y' : 'ies'} · {counts.active} active
          </Text>
          {categories.map((category, index) => {
            const isEditing = editingId === category.id;
            const isDeactivating = deactivatingId === category.id;
            const isBusy = busy === category.id;

            return (
              <View
                key={category.id}
                className="rounded-lg border border-hairline bg-surface p-4 dark:border-hairline-strong"
              >
                <View className="flex-row flex-wrap items-start justify-between gap-3">
                  <View className="min-w-48 flex-1">
                    <Text className="font-bold text-primary">{category.name}</Text>
                    <Text className="mt-1 text-sm text-secondary">
                      {category.description ?? 'No description'} · {category.serviceCount} service
                      {category.serviceCount === 1 ? '' : 's'}
                    </Text>
                    <Text className="mt-1 text-xs text-tertiary">{category.slug}</Text>
                  </View>
                  <StatusBadge
                    label={category.isActive ? 'Active' : 'Inactive'}
                    tone={category.isActive ? 'success' : 'neutral'}
                  />
                </View>

                {isEditing ? (
                  <View className="mt-3 gap-3">
                    <TextInput
                      accessibilityLabel="Edit category name"
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="Category name"
                      placeholderTextColor="#94a3b8"
                      className="min-h-11 rounded-lg border border-hairline-strong bg-surface px-3 text-sm text-primary"
                    />
                    <TextInput
                      accessibilityLabel="Edit category description"
                      value={editDescription}
                      onChangeText={setEditDescription}
                      placeholder="Description (optional)"
                      placeholderTextColor="#94a3b8"
                      multiline
                      className="min-h-16 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                    />
                    <View className="flex-row gap-3">
                      <ActionButton
                        label="Save changes"
                        onPress={() => saveEdit(category)}
                        busy={busy === `edit:${category.id}`}
                        disabled={busy !== null || editName.trim().length < 2}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel editing category"
                        onPress={cancelEdit}
                        disabled={busy !== null}
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-sm font-semibold text-secondary">Cancel</Text>
                      </Pressable>
                    </View>
                    <Text className="text-xs text-tertiary">
                      The address customers use for this page does not change when you rename it, so
                      existing links keep working.
                    </Text>
                  </View>
                ) : null}

                {isDeactivating ? (
                  <View className="mt-3 gap-3">
                    <TextInput
                      accessibilityLabel="Reason for withdrawing the category"
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Why is this category being withdrawn?"
                      placeholderTextColor="#94a3b8"
                      multiline
                      className="min-h-16 rounded-lg border border-hairline-strong bg-surface px-3 py-2 text-sm text-primary"
                    />
                    <Text className="text-xs text-tertiary">
                      This reason is recorded against your name in the audit log.
                    </Text>
                    <View className="flex-row gap-3">
                      <ActionButton
                        label="Confirm withdrawal"
                        onPress={() => setStatus(category, false, reason.trim())}
                        busy={isBusy}
                        disabled={busy !== null || reason.trim().length < 3}
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel withdrawal"
                        onPress={cancelDeactivate}
                        disabled={busy !== null}
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-sm font-semibold text-secondary">Cancel</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {!isEditing && !isDeactivating ? (
                  <View className="mt-3 flex-row flex-wrap items-center gap-4">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${category.name}`}
                      disabled={busy !== null}
                      onPress={() => beginEdit(category)}
                    >
                      <Text className="text-sm font-semibold text-action-text">Edit</Text>
                    </Pressable>
                    {category.isActive ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Withdraw ${category.name}`}
                        disabled={busy !== null}
                        onPress={() => beginDeactivate(category)}
                      >
                        <Text className="text-sm font-semibold text-danger">Deactivate</Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Restore ${category.name}`}
                        disabled={busy !== null}
                        onPress={() => setStatus(category, true)}
                      >
                        <Text className="text-sm font-semibold text-action-text">
                          {isBusy ? 'Working...' : 'Reactivate'}
                        </Text>
                      </Pressable>
                    )}
                    <View className="flex-row items-center gap-2">
                      <Text className="text-xs text-tertiary">Order</Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${category.name} up`}
                        accessibilityState={{ disabled: busy !== null || index === 0 }}
                        disabled={busy !== null || index === 0}
                        onPress={() => reorder(category, -1)}
                        className="min-h-9 min-w-9 items-center justify-center rounded-lg border border-hairline-strong px-2"
                      >
                        <Text className="text-sm text-primary">↑</Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Move ${category.name} down`}
                        accessibilityState={{
                          disabled: busy !== null || index === categories.length - 1,
                        }}
                        disabled={busy !== null || index === categories.length - 1}
                        onPress={() => reorder(category, 1)}
                        className="min-h-9 min-w-9 items-center justify-center rounded-lg border border-hairline-strong px-2"
                      >
                        <Text className="text-sm text-primary">↓</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
      <InlineError message={error} />
      <InlineSuccess message={notice} />
    </View>
  );
}
