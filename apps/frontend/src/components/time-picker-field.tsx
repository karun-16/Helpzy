import { useMemo, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Popover, PopoverHeader } from '@/components/popover';

const DIAL_SIZE = 176;
const HAND_LENGTH = 58;
const CENTER = DIAL_SIZE / 2;

/**
 * Parses `hh:mm AM/PM` into 24-hour parts.
 *
 * The booking API stores an instant, so the 12-hour value the user picks has to
 * be converted rather than passed through. `parseDisplayTime` is the single
 * place that conversion happens, so the dial and manual typing cannot disagree.
 */
export function parseDisplayTime(
  value: string,
): { hour: number; minute: number; period: 'AM' | 'PM' } | null {
  const match = /^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/i.exec(value.trim());
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  return {
    hour: hour12,
    minute,
    period: match[3].toUpperCase() === 'PM' ? 'PM' : 'AM',
  };
}

/** Converts the 12-hour selection to the 24-hour hour the API expects. */
export function to24Hour(hour12: number, period: 'AM' | 'PM'): number {
  return (hour12 % 12) + (period === 'PM' ? 12 : 0);
}

/**
 * The point of a press, relative to the dial.
 *
 * React Native's gesture events carry `locationX`/`locationY`, but React Native
 * Web passes the underlying DOM event straight through, which has no such
 * fields. Reading only `locationX` therefore made the whole clock face dead to
 * a mouse and to anyone using the web build. `offsetX`/`offsetY` are the DOM
 * equivalents and are measured against the same element, so trying them second
 * makes one code path work on native and on web.
 *
 * Returns null when none is available, so callers can ignore the event instead of
 * computing from `undefined` and producing NaN coordinates.
 */
function pressPoint(event: {
  nativeEvent?: unknown;
  currentTarget?: { getBoundingClientRect?: () => { left: number; top: number } } | null;
}): { x: number; y: number } | null {
  const e = (event.nativeEvent ?? {}) as Record<string, unknown>;
  const numberAt = (key: string): number | null => {
    const value = e[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };

  const locationX = numberAt('locationX');
  const locationY = numberAt('locationY');
  if (locationX !== null && locationY !== null) return { x: locationX, y: locationY };

  const offsetX = numberAt('offsetX');
  const offsetY = numberAt('offsetY');
  if (offsetX !== null && offsetY !== null) return { x: offsetX, y: offsetY };

  /*
   * Last resort, and the one that matters most on web during a drag: a move
   * event carries only page coordinates, so they have to be rebased onto the
   * dial's own rectangle. Doing this from the rect rather than assuming the
   * dial sits at the origin is what keeps the hand under the pointer when the
   * picker is scrolled or opened lower down the page.
   */
  const clientX = numberAt('clientX') ?? numberAt('pageX');
  const clientY = numberAt('clientY') ?? numberAt('pageY');
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (clientX !== null && clientY !== null && rect) {
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  return null;
}

export function formatDisplayTime(hour: number, minute: number, period: 'AM' | 'PM'): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${period}`;
}

type Mode = 'hour' | 'minute';

/** Where a hand points on the dial for a value, in degrees from 12 o'clock. */
function handAngle(value: number, total: number): number {
  return (value / total) * 360;
}

function polarToCartesian(angleDeg: number, radius: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

/**
 * A clock face the user can drag or click.
 *
 * Drawn with plain views rather than SVG so it needs no new dependency and
 * renders identically under Expo web and native. The selection follows the
 * pointer while dragging, so the value is visible under the finger rather than
 * only after release.
 */
function ClockDial({
  mode,
  value,
  onChange,
}: {
  mode: Mode;
  value: number;
  onChange: (next: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const isHour = mode === 'hour';
  const total = isHour ? 12 : 60;
  // Minutes snap to 5 so the choice is quick; a free 60-stop dial is unusable
  // with a finger.
  const step = isHour ? 1 : 5;
  const steps = isHour ? 12 : 12;

  const hand = useMemo(
    () => polarToCartesian(handAngle(value, total), HAND_LENGTH),
    [value, total],
  );

  const apply = (point: { x: number; y: number } | null) => {
    if (!point) return;
    const dx = point.x - CENTER;
    const dy = point.y - CENTER;
    // atan2 with the 12 o'clock axis as zero, matching `handAngle`.
    let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (deg < 0) deg += 360;
    const raw = (deg / 360) * total;
    const snapped = Math.round(raw / step) * step;
    const next = isHour
      ? ((Math.round(snapped) - 1 + 12) % 12) + 1
      : Math.min(59, Math.max(0, snapped));
    onChange(next);
  };

  const ticks = Array.from({ length: steps }, (_, index) => index);

  /*
   * `adjustable` promises increment/decrement to assistive tech, so the dial has
   * to honour them. Without this the clock face was pointer-only: a screen reader
   * or keyboard user could read the hour but never change it.
   */
  const stepBy = (delta: number) => {
    if (isHour) {
      const base = value === 12 ? 0 : value;
      onChange(((base + delta - 1 + 12) % 12) + 1);
      return;
    }
    const base = Math.round(value / step) * step;
    const next = Math.min(59, Math.max(0, base + delta * step));
    onChange(next);
  };

  return (
    <Pressable
      accessibilityRole="adjustable"
      accessibilityLabel={isHour ? 'Select hour' : 'Select minute'}
      accessibilityValue={{ now: value, min: isHour ? 1 : 0, max: total - 1 }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') stepBy(1);
        if (event.nativeEvent.actionName === 'decrement') stepBy(-1);
      }}
      accessibilityHint={
        isHour
          ? 'Drag around the clock face to choose an hour'
          : 'Drag to choose minutes in steps of five'
      }
      onPressIn={(event) => {
        setDragging(true);
        apply(pressPoint(event));
      }}
      onPressMove={(event) => {
        if (!dragging) return;
        apply(pressPoint(event));
      }}
      onPressOut={() => setDragging(false)}
      /*
       * The press callbacks above are the happy path on native, but on web a
       * mouse drag does not reliably raise `onPressMove`, so the hand stopped
       * following the pointer and only the initial click registered. The
       * responder system is implemented on both platforms, so it carries the
       * drag; `apply` is idempotent, so a gesture that raises both sets the
       * same value twice rather than fighting itself.
       */
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => dragging}
      onResponderGrant={(event) => {
        setDragging(true);
        apply(pressPoint(event));
      }}
      onResponderMove={(event) => {
        if (!dragging) return;
        apply(pressPoint(event));
      }}
      onResponderRelease={() => setDragging(false)}
      onResponderTerminate={() => setDragging(false)}
      className="items-center justify-center self-center rounded-full"
      style={{ width: DIAL_SIZE, height: DIAL_SIZE }}
    >
      <View
        style={{
          width: DIAL_SIZE,
          height: DIAL_SIZE,
          borderRadius: DIAL_SIZE / 2,
        }}
        className="border-2 border-hairline bg-surface dark:border-hairline-strong dark:bg-slate-800"
      >
        {/* Hour marks, and minute marks only when choosing minutes. */}
        {ticks.map((index) => {
          const angle = handAngle(index, total);
          const outer = polarToCartesian(angle, CENTER - 6);
          const inner = polarToCartesian(angle, CENTER - (isHour ? 14 : 12));
          const active = isHour ? value === index + 1 : Math.round(value / 5) * 5 === index * 5;
          return (
            <View
              key={index}
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: inner.x,
                top: inner.y,
                width: Math.max(1, outer.x - inner.x),
                height: Math.max(1, outer.y - inner.y),
                backgroundColor: active ? '#1b65f0' : '#94a3b8',
                transformOrigin: 'left center',
                transform: [{ rotate: `${angle}deg` }],
              }}
            />
          );
        })}

        {/* The selected label sits at the end of the hand. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: hand.x - 17,
            top: hand.y - 17,
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: '#1b65f0',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text className="text-sm font-bold text-white">
            {isHour ? String(value) : String(value).padStart(2, '0')}
          </Text>
        </View>

        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: CENTER - 4,
            top: CENTER - 4,
            width: 8,
            height: 8,
            borderRadius: 4,
          }}
          className="bg-primary"
        />
      </View>
    </Pressable>
  );
}

/**
 * The time field and its compact clock.
 *
 * The selection follows the requested order - hour, then minutes, then AM/PM -
 * and only confirms once the user is done, so a single tap on the face does not
 * discard the rest of the value. Manual entry stays available as a fallback.
 */
export function TimePickerField({
  value,
  onChange,
  label = 'Booking time',
}: {
  value: string;
  onChange: (next: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const dismissedRef = useRef(false);
  const [mode, setMode] = useState<Mode>('hour');
  const fieldRef = useRef<View>(null);

  const parsed = parseDisplayTime(value);
  const [hour, setHour] = useState(parsed?.hour ?? 10);
  const [minute, setMinute] = useState(parsed?.minute ?? 0);
  const [period, setPeriod] = useState<'AM' | 'PM'>(parsed?.period ?? 'AM');

  // Adopt whatever the field currently holds each time the popover opens, so
  // typed text is the starting point rather than being overwritten.
  const syncFromField = () => {
    const current = parseDisplayTime(value);
    if (current) {
      setHour(current.hour);
      setMinute(current.minute);
      setPeriod(current.period);
    }
    setMode('hour');
  };

  const close = () => {
    dismissedRef.current = true;
    setOpen(false);
  };

  const commit = () => {
    onChange(formatDisplayTime(hour, minute, period));
    close();
  };

  const preview = formatDisplayTime(hour, minute, period);

  return (
    <View>
      <View className="flex-row items-center gap-2">
        <TextInput
          ref={fieldRef as never}
          accessibilityLabel={label}
          value={value}
          onChangeText={onChange}
          onFocus={() => {
            /*
             * Dismissing the modal hands focus back to the input, and on web that
             * immediately re-fires focus. Without swallowing that one event the
             * picker reopened the instant it was confirmed, so the panel kept
             * sitting on top of the rest of the form.
             */
            if (dismissedRef.current) {
              dismissedRef.current = false;
              return;
            }
            syncFromField();
            setOpen(true);
          }}
          placeholder="02:30 PM"
          placeholderTextColor="#94a3b8"
          className="min-h-12 flex-1 rounded-lg border border-hairline-strong bg-surface px-3 text-base text-primary dark:bg-slate-800"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open time picker"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            syncFromField();
            setOpen((current) => !current);
          }}
          className="min-h-12 w-12 items-center justify-center rounded-lg border border-hairline-strong bg-surface active:bg-surface-muted dark:bg-slate-800 dark:active:bg-slate-700"
        >
          <Text className="text-lg text-secondary">🕐</Text>
        </Pressable>
      </View>

      {value.trim() && !parsed ? (
        <Text
          accessibilityRole="alert"
          className="mt-1.5 text-xs font-medium text-rose-700 dark:text-rose-300"
        >
          Enter a time as 02:30 PM.
        </Text>
      ) : null}

      <Popover
        visible={open}
        onClose={close}
        anchorRef={fieldRef}
        width={308}
        maxHeight={420}
        label="Choose a time"
      >
        <PopoverHeader title="Choose a time" onClose={close} />

        {/* 1. hour, 2. minutes, 3. AM/PM - the order the selection is made in. */}
        <View className="mb-2 flex-row items-center justify-center gap-2">
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'hour' }}
            onPress={() => setMode('hour')}
            className={`min-h-12 min-w-16 items-center justify-center rounded-lg border px-3 ${
              mode === 'hour'
                ? 'border-brand-700 bg-brand-700'
                : 'border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
            }`}
          >
            <Text
              className={`text-xl font-bold ${
                mode === 'hour' ? 'text-white' : 'text-primary dark:text-primary'
              }`}
            >
              {String(hour).padStart(2, '0')}
            </Text>
          </Pressable>
          <Text className="text-xl font-bold text-muted">:</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: mode === 'minute' }}
            onPress={() => setMode('minute')}
            className={`min-h-12 min-w-16 items-center justify-center rounded-lg border px-3 ${
              mode === 'minute'
                ? 'border-brand-700 bg-brand-700'
                : 'border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
            }`}
          >
            <Text
              className={`text-xl font-bold ${
                mode === 'minute' ? 'text-white' : 'text-primary dark:text-primary'
              }`}
            >
              {String(minute).padStart(2, '0')}
            </Text>
          </Pressable>
          <View className="ml-1">
            {(['AM', 'PM'] as const).map((value_) => (
              <Pressable
                key={value_}
                accessibilityRole="radio"
                accessibilityState={{ selected: period === value_ }}
                onPress={() => setPeriod(value_)}
                className={`mb-1 min-h-8 w-14 items-center justify-center rounded-lg border last:mb-0 ${
                  period === value_
                    ? 'border-brand-700 bg-brand-700'
                    : 'border-hairline-strong bg-surface dark:border-hairline-strong dark:bg-slate-800'
                }`}
              >
                <Text
                  className={`text-xs font-bold ${
                    period === value_ ? 'text-white' : 'text-secondary dark:text-primary'
                  }`}
                >
                  {value_}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ClockDial
          mode={mode}
          value={mode === 'hour' ? hour : minute}
          onChange={(next) => {
            if (mode === 'hour') {
              setHour(next);
              // Moving past the hour is the signal that the hour is settled, so
              // the next interaction edits the minutes without another tap.
              setMode('minute');
            } else {
              setMinute(next);
            }
          }}
        />

        <View className="mt-3 flex-row items-center gap-2 border-t border-hairline pt-3 dark:border-hairline-strong">
          <Text className="flex-1 text-sm font-semibold text-primary">{preview}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              syncFromField();
              close();
            }}
            className="min-h-10 justify-center rounded-lg px-2 active:bg-surface-muted dark:active:bg-slate-700"
          >
            <Text className="text-xs font-semibold text-secondary">Cancel</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Confirm time"
            onPress={commit}
            className="min-h-10 justify-center rounded-lg bg-brand-700 px-3 active:bg-brand-800"
          >
            <Text className="text-xs font-bold text-white">Set time</Text>
          </Pressable>
        </View>
      </Popover>
    </View>
  );
}
