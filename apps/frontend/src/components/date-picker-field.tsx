import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Popover, PopoverHeader } from '@/components/popover';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Midnight today, so a day is "past" only by date and not by clock time. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function sameDay(a: Date | null, b: Date): boolean {
  return (
    a !== null &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Parses `DD/MM/YYYY`, rejecting values that are not real calendar dates.
 *
 * `new Date(2026, 1, 31)` silently becomes 3 March, so the round-trip check is
 * what actually rejects "31/02/2026" rather than quietly booking a different day.
 */
export function parseDisplayDate(value: string): Date | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

export function formatDisplayDate(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

/**
 * The date field and its compact calendar.
 *
 * The calendar is a popover anchored to the field rather than a block in the
 * form, so choosing a date does not push the rest of the booking down the page.
 * Typing still works, and the field keeps `DD/MM/YYYY` because that is what an
 * Indian user reads off a calendar.
 */
export function DatePickerField({
  value,
  onChange,
  label = 'Booking date',
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);
  const fieldRef = useRef<View>(null);
  const selected = useMemo(() => parseDisplayDate(value), [value]);
  const [month, setMonth] = useState(
    () => selected ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );

  const today = startOfToday();
  const weeks = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    // Whole weeks only, so the grid is 5 or 6 rows rather than a fixed 42 cells
    // that leave a mostly-empty strip at the bottom of shorter months.
    const leading = first.getDay();
    const total = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const cells = Math.ceil((leading + total) / 7) * 7;
    return Array.from(
      { length: cells },
      (_, index) =>
        new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index),
    );
  }, [month]);

  const monthLabel = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(month);

  const close = () => {
    dismissedRef.current = true;
    setOpen(false);
  };

  const pick = (day: Date) => {
    onChange(formatDisplayDate(day));
    close();
  };

  return (
    <View>
      <View className="flex-row items-center gap-2">
        <TextInput
          ref={fieldRef as never}
          accessibilityLabel={label}
          value={value}
          onChangeText={(next) => {
            onChange(next);
            const parsed = parseDisplayDate(next);
            if (parsed) setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
          }}
          onFocus={() => {
            /*
             * Closing the modal returns focus to this input, which on web
             * re-fires focus and would immediately reopen the calendar over the
             * form. Swallow exactly that one event.
             */
            if (dismissedRef.current) {
              dismissedRef.current = false;
              return;
            }
            setOpen(true);
          }}
          placeholder="DD/MM/YYYY"
          placeholderTextColor="#94a3b8"
          keyboardType="numeric"
          className="min-h-12 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 text-base text-primary dark:bg-slate-800"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open calendar"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen((current) => !current)}
          className="min-h-12 w-12 items-center justify-center rounded-lg border border-hairline-strong bg-surface active:bg-surface-muted dark:bg-slate-800 dark:active:bg-slate-700"
        >
          <Text className="text-lg text-secondary">📅</Text>
        </Pressable>
      </View>

      {/*
        The message is tied to the field so it is announced with it, and it only
        appears once the field has been touched - an untouched form should not
        start by telling the user they got something wrong.
      */}
      {value.trim() && !selected ? (
        <Text
          accessibilityRole="alert"
          className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          Enter a real date as DD/MM/YYYY.
        </Text>
      ) : null}
      {selected && selected.getTime() < today.getTime() ? (
        <Text
          accessibilityRole="alert"
          className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          That date has passed. Choose today or a later date.
        </Text>
      ) : null}

      <Popover
        visible={open}
        onClose={close}
        anchorRef={fieldRef}
        width={308}
        maxHeight={392}
        label="Choose a date"
      >
        <PopoverHeader title="Choose a date" onClose={close} />
        <View className="flex-row items-center justify-between">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Previous month"
            onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="min-h-9 w-9 items-center justify-center rounded-lg border border-hairline-strong bg-surface active:bg-surface-muted dark:bg-slate-800 dark:active:bg-slate-700"
          >
            <Text className="text-lg font-bold text-secondary dark:text-primary">‹</Text>
          </Pressable>
          <Text className="text-sm font-bold text-primary">{monthLabel}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Next month"
            onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="min-h-9 w-9 items-center justify-center rounded-lg border border-hairline-strong bg-surface active:bg-surface-muted dark:bg-slate-800 dark:active:bg-slate-700"
          >
            <Text className="text-lg font-bold text-secondary dark:text-primary">›</Text>
          </Pressable>
        </View>

        <View className="mt-2 flex-row">
          {WEEKDAYS.map((day, index) => (
            <View
              key={`${day}-${index}`}
              style={{ width: '14.2857%' }}
              className="items-center py-1"
            >
              <Text
                accessibilityLabel={WEEKDAY_LONG[index]}
                className="text-[11px] font-semibold text-muted"
              >
                {day}
              </Text>
            </View>
          ))}
        </View>

        <View className="flex-row flex-wrap">
          {weeks.map((day) => {
            const inMonth = day.getMonth() === month.getMonth();
            const disabled = !inMonth || day.getTime() < today.getTime();
            const isSelected = sameDay(selected, day);
            const isToday = sameDay(today, day);
            return (
              <View key={day.toISOString()} style={{ width: '14.2857%' }} className="p-0.5">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={formatDisplayDate(day)}
                  accessibilityState={{ selected: isSelected, disabled }}
                  disabled={disabled}
                  onPress={() => pick(day)}
                  className={`min-h-9 items-center justify-center rounded-lg ${
                    isSelected
                      ? 'bg-brand-700'
                      : isToday
                        ? 'border border-brand-300 dark:border-brand-700'
                        : 'active:bg-surface-muted dark:active:bg-slate-700'
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      isSelected
                        ? 'text-white'
                        : disabled
                          ? 'text-muted dark:text-secondary'
                          : 'text-primary dark:text-primary'
                    }`}
                  >
                    {day.getDate()}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View className="mt-2 flex-row items-center justify-between gap-2 border-t border-hairline pt-2 dark:border-hairline-strong">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Use today"
            onPress={() => pick(today)}
            className="min-h-9 justify-center rounded-lg px-2 active:bg-surface-muted dark:active:bg-slate-700"
          >
            <Text className="text-xs font-semibold text-brand-800 dark:text-brand-300">Today</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={close}
            className="min-h-9 justify-center rounded-lg px-2 active:bg-surface-muted dark:active:bg-slate-700"
          >
            <Text className="text-xs font-semibold text-secondary">Done</Text>
          </Pressable>
        </View>
      </Popover>
    </View>
  );
}
